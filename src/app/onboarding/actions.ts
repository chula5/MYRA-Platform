'use server'

import { createServerClient, createAdminClient } from '@/lib/supabase-server'

export interface OnboardingPayload {
  ageRange: string
  brandGroups: string[]
  likedOutfitIds: string[]
  dislikedOutfitIds: string[]
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
