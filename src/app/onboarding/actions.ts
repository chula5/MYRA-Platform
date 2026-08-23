'use server'

import { createServerClient, createAdminClient } from '@/lib/supabase-server'
import {
  normaliseProfile,
  softPriorVector,
  SOFT_PRIOR_WEIGHT,
  type ClientStyleProfile,
} from '@/lib/style-profile'
import { accumulate, zeroVector } from '@/lib/taste-vector'

export interface OnboardingPayload {
  ageRange: string
  brandGroups: string[]
  likedOutfitIds: string[]
  dislikedOutfitIds: string[]
}

// What the questionnaire screens collect. Every field optional — a skipped
// question is null, which means "no constraint", never "unknown".
export type StyleProfileInput = Partial<Omit<ClientStyleProfile, 'user_id'>>

/**
 * Persist the style questionnaire, then act on it:
 *   HARD  price_comfort → user_taste_profile.price_tier_range (the item mask
 *         reads the profile row directly; this mirrors the range for the
 *         existing brand/price machinery)
 *   SOFT  a one-time prior folded into the taste vector at ~3 likes' weight,
 *         stamped with prior_applied_at so re-running can't stack it twice.
 * Never throws: onboarding must not dead-end on a learning write.
 */
export async function saveStyleProfile(input: StyleProfileInput): Promise<{ error?: string }> {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'Not signed in' }
    const admin = createAdminClient()

    const clean = <T,>(v: T[] | null | undefined) => (Array.isArray(v) && v.length ? v : null)
    const row = {
      user_id: user.id,
      colour_never: clean(input.colour_never),
      length_no_go: clean(input.length_no_go),
      heel_preference: input.heel_preference ?? null,
      price_comfort: clean(input.price_comfort as number[] | null),
      colour_loved: clean(input.colour_loved),
      fit_top: input.fit_top ?? null,
      fit_bottom: input.fit_bottom ?? null,
      pattern_appetite: input.pattern_appetite ?? null,
      occasion_mix: input.occasion_mix && Object.keys(input.occasion_mix).length ? input.occasion_mix : null,
      brands_missed: input.brands_missed?.trim() || null,
      notes: input.notes?.trim() || null,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    const { error: upsertErr } = await (admin.from('client_style_profile') as any)
      .upsert(row, { onConflict: 'user_id' })
    if (upsertErr) {
      // Migration 0038 not run yet — log and let onboarding continue.
      console.error('[saveStyleProfile] upsert', upsertErr)
      return { error: 'saved_partial' }
    }

    const profile = normaliseProfile(row)

    // HARD: mirror the spend range for the price-aware brand machinery.
    if (profile?.price_comfort?.length === 2) {
      await (admin.from('user_taste_profile') as any).upsert(
        { user_id: user.id, price_tier_range: profile.price_comfort, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      )
    }

    // SOFT: one-time prior on the taste vector, once only.
    const prior = softPriorVector(profile)
    if (prior) {
      const { data: existing } = await (admin.from('client_style_profile') as any)
        .select('prior_applied_at').eq('user_id', user.id).maybeSingle()
      if (!existing?.prior_applied_at) {
        const { data: tp } = await admin
          .from('user_taste_profile').select('taste_vector').eq('user_id', user.id).maybeSingle()
        const current = parseStoredVector((tp as any)?.taste_vector) ?? zeroVector()
        const next = accumulate(current, prior, SOFT_PRIOR_WEIGHT)
        await (admin.from('user_taste_profile') as any).upsert(
          { user_id: user.id, taste_vector: next, updated_at: new Date().toISOString() },
          { onConflict: 'user_id' },
        )
        await (admin.from('client_style_profile') as any)
          .update({ prior_applied_at: new Date().toISOString() })
          .eq('user_id', user.id)
      }
    }

    return {}
  } catch (err: unknown) {
    console.error('[saveStyleProfile]', err)
    return { error: err instanceof Error ? err.message : 'Failed to save' }
  }
}

// pgvector comes back from PostgREST as "[0.1,0.2,…]".
function parseStoredVector(v: unknown): number[] | null {
  if (Array.isArray(v)) return v as number[]
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v)
      return Array.isArray(parsed) ? parsed : null
    } catch { return null }
  }
  return null
}

// Persist a user's onboarding answers and mark them onboarded.
export async function saveOnboarding(payload: OnboardingPayload): Promise<{ error?: string }> {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'Not signed in' }

    const admin = createAdminClient()

    // Upsert the preference row (one per user) for easy admin aggregation.
    const { error: upsertErr } = await (admin.from('signup_preference') as any).upsert({
      user_id: user.id,
      email: user.email,
      age_range: payload.ageRange || null,
      brand_groups: payload.brandGroups ?? [],
      liked_outfit_ids: payload.likedOutfitIds ?? [],
      disliked_outfit_ids: payload.dislikedOutfitIds ?? [],
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })

    if (upsertErr) {
      // Don't block the user (e.g. if the migration hasn't been run yet) — log it
      // and still mark them onboarded below so they're not stuck in a redirect loop.
      console.error('[saveOnboarding] upsert', upsertErr)
    }

    // Mirror onboarded + age range into user_metadata for fast gating/filtering.
    // Always set this, even if the table write failed, to avoid a redirect loop.
    const { data: got } = await admin.auth.admin.getUserById(user.id)
    const meta = got.user?.user_metadata ?? {}
    await admin.auth.admin.updateUserById(user.id, {
      user_metadata: { ...meta, onboarded: true, age_range: payload.ageRange || null },
    })

    return upsertErr ? { error: 'saved_partial' } : {}
  } catch (err: unknown) {
    console.error('[saveOnboarding]', err)
    return { error: err instanceof Error ? err.message : 'Failed to save' }
  }
}

// ── Sizes + second-hand consent ──────────────────────────────────────────────

export interface SizeAnswers {
  /** Canonical UK values per category, plus the optional "I also wear" size. */
  tops?: { value: number | null; adjacent: number | null }
  bottoms?: { value: number | null; adjacent: number | null }
  outerwear?: { value: number | null; adjacent: number | null }
  shoes?: { value: number | null; adjacent: number | null }
  acceptsSecondHand: boolean
}

/**
 * Persist her sizes and her answer on pre-loved pieces.
 *
 * Both facts change what she is SHOWN, not just how it's ranked — a one-of-one
 * outside her size never reaches her, and pre-loved stock appears only if she
 * asked for it — so this is saved on its own rather than bundled with the rest
 * of onboarding, and it stands even if she abandons the flow afterwards.
 */
export async function saveSizes(answers: SizeAnswers): Promise<{ error?: string }> {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'Not signed in' }

    const { saveUserSizeProfile } = await import('@/lib/size-availability')
    const profile: Record<string, { value: number | null; adjacent: number | null }> = {}
    for (const key of ['tops', 'bottoms', 'outerwear', 'shoes'] as const) {
      const a = answers[key]
      if (a?.value != null) profile[key] = { value: a.value, adjacent: a.adjacent ?? null }
    }

    const res = await saveUserSizeProfile(user.id, profile as any, answers.acceptsSecondHand)
    if (res.error) return res

    // Mirror her main clothing size into user_metadata: the feed's size filter
    // pre-fills from it, and reading metadata is far cheaper than a table hit
    // on every render.
    try {
      const admin = createAdminClient()
      const { data: got } = await admin.auth.admin.getUserById(user.id)
      const meta = got.user?.user_metadata ?? {}
      await admin.auth.admin.updateUserById(user.id, {
        user_metadata: { ...meta, clothing_uk: profile.tops?.value ?? null },
      })
    } catch (err) {
      console.error('[saveSizes] metadata mirror', err)
    }

    return {}
  } catch (err: unknown) {
    console.error('[saveSizes]', err)
    return { error: err instanceof Error ? err.message : 'Failed to save your sizes' }
  }
}

/** Her current sizes + consent, for the settings screen. */
export async function loadSizes(): Promise<SizeAnswers | null> {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null
    const { loadUserSizeProfile } = await import('@/lib/size-availability')
    const ctx = await loadUserSizeProfile(user.id)
    return {
      tops: ctx.profile.tops ?? undefined,
      bottoms: ctx.profile.bottoms ?? undefined,
      outerwear: ctx.profile.outerwear ?? undefined,
      shoes: ctx.profile.shoes ?? undefined,
      acceptsSecondHand: ctx.acceptsSecondHand,
    }
  } catch {
    return null
  }
}
