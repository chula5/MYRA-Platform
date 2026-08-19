'use server'

// CLIENT ACCOUNTS — pilot clients assigned to a persona.
//
// The client role grants nothing in /admin: that stays locked to the single
// hardcoded ADMIN_USER_ID. A client can reach /me and nothing else.
//
// No email infrastructure for the pilot — the invite link is returned to admin
// and shared by hand.

import { createAdminClient } from '@/lib/supabase-server'
import { revalidatePath } from 'next/cache'
import {
  PERSONA_START_WEIGHT,
  personaWeight,
  envelopeDistance,
} from '@/lib/user-persona'
import { CONSTRAINED_DIMS } from '@/lib/inspiration'
import { normaliseProfile, type ClientStyleProfile } from '@/lib/style-profile'

const CLIENT_ROLE = 'client'
const PATH = '/admin/stylists'

export interface ClientRow {
  user_id: string
  name: string
  email: string | null
  persona_id: string | null
  persona_name: string | null
  weight: number | null
  behavioural_events: number
  uploads: number
  created_at: string
}

function randomPassword(): string {
  // Readable temp password — the client changes nothing for the pilot, she just
  // needs to be able to type it.
  const words = ['linen', 'atelier', 'rivoli', 'ivory', 'camel', 'poplin', 'saison', 'marais']
  const w = words[Math.floor(Math.random() * words.length)]
  const n = String(Math.floor(1000 + Math.random() * 9000))
  return `${w}-${n}-myra`
}

/**
 * Create a pilot client: auth user with role=client, a client_profile row, and
 * a soft persona assignment at the starting weight. Returns an invite link and
 * the temp password for manual sharing.
 */
export async function createClient(
  name: string,
  email: string,
  personaId: string,
): Promise<{ userId?: string; inviteUrl?: string; password?: string; error?: string }> {
  const cleanName = (name ?? '').trim()
  const cleanEmail = (email ?? '').trim().toLowerCase()
  if (!cleanName) return { error: 'Name required' }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) return { error: 'Enter a valid email address' }
  if (!personaId) return { error: 'Choose a persona to assign her to' }

  const admin = createAdminClient()
  try {
    const password = randomPassword()
    const { data: created, error } = await admin.auth.admin.createUser({
      email: cleanEmail,
      password,
      email_confirm: true, // no email step — she can sign in immediately
      user_metadata: { role: CLIENT_ROLE, name: cleanName },
    })
    if (error) {
      if (/already|exists|registered/i.test(error.message)) return { error: 'An account with that email already exists' }
      throw error
    }
    const userId = created.user!.id

    await (admin.from('client_profile') as any).upsert(
      { user_id: userId, name: cleanName, email: cleanEmail, persona_id: personaId },
      { onConflict: 'user_id' },
    )
    await (admin.from('user_persona') as any).upsert(
      { user_id: userId, persona_id: personaId, weight: PERSONA_START_WEIGHT, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    )
    await (admin.from('user_persona_weight_log') as any).insert({
      user_id: userId, persona_id: personaId, weight: PERSONA_START_WEIGHT, event_count: 0,
    })

    const base = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
    revalidatePath(PATH)
    return { userId, inviteUrl: `${base}/signin`, password }
  } catch (err) {
    console.error('[createClient]', err)
    return { error: err instanceof Error ? err.message : 'Could not create the client' }
  }
}

/** Every pilot client, with their current persona weight and activity. */
export async function listClients(): Promise<{ clients: ClientRow[]; error?: string }> {
  try {
    const admin = createAdminClient() as any
    const { data: profiles, error } = await admin
      .from('client_profile').select('*').order('created_at', { ascending: false })
    if (error) return { clients: [], error: error.message }
    if (!profiles?.length) return { clients: [] }

    const ids = profiles.map((p: any) => p.user_id)
    const [{ data: personas }, { data: assignments }, { data: events }, { data: uploads }] = await Promise.all([
      admin.from('stylist').select('stylist_id, name'),
      admin.from('user_persona').select('user_id, weight').in('user_id', ids),
      admin.from('taste_event').select('user_id, event_type, pool').in('user_id', ids),
      admin.from('inspiration_image').select('user_id').in('user_id', ids),
    ])
    const personaName = new Map((personas ?? []).map((p: any) => [p.stylist_id, p.name]))
    const weightBy = new Map((assignments ?? []).map((a: any) => [a.user_id, a.weight]))
    const behaviouralBy = new Map<string, number>()
    for (const e of events ?? []) {
      if (e.pool === 'aspirational' || e.event_type === 'inspiration_upload') continue
      behaviouralBy.set(e.user_id, (behaviouralBy.get(e.user_id) ?? 0) + 1)
    }
    const uploadsBy = new Map<string, number>()
    for (const u of uploads ?? []) if (u.user_id) uploadsBy.set(u.user_id, (uploadsBy.get(u.user_id) ?? 0) + 1)

    return {
      clients: profiles.map((p: any) => ({
        user_id: p.user_id,
        name: p.name,
        email: p.email ?? null,
        persona_id: p.persona_id ?? null,
        persona_name: p.persona_id ? (personaName.get(p.persona_id) ?? null) : null,
        weight: weightBy.get(p.user_id) ?? null,
        behavioural_events: behaviouralBy.get(p.user_id) ?? 0,
        uploads: uploadsBy.get(p.user_id) ?? 0,
        created_at: p.created_at,
      })),
    }
  } catch (err) {
    return { clients: [], error: err instanceof Error ? err.message : 'Load failed' }
  }
}

export interface ClientDetail {
  profile: ClientStyleProfile | null
  uploads: {
    image_id: string
    image_url: string
    status: string
    scores: Record<string, unknown> | null
    corrected_fields: string[]
    created_at: string
    distance: number
    worst: { dim: number; sigma: number }[]
  }[]
  weightHistory: { weight: number; event_count: number; created_at: string }[]
  personaName: string | null
  weight: number | null
  error?: string
}

/**
 * The admin view of one client: her style profile, her inspiration grid, her
 * persona weight over time, and the disagreement list — uploads sorted by how
 * far they sit outside the persona envelope. That list is the pilot's most
 * important output: it says where the assignment was wrong.
 */
export async function loadClientDetail(userId: string): Promise<ClientDetail> {
  const empty: ClientDetail = { profile: null, uploads: [], weightHistory: [], personaName: null, weight: null }
  try {
    const admin = createAdminClient() as any
    const { data: cp } = await admin.from('client_profile').select('*').eq('user_id', userId).maybeSingle()
    const personaId = cp?.persona_id ?? null

    const [{ data: styleRow }, { data: assignment }, { data: images }, { data: history }, { data: persona }] =
      await Promise.all([
        admin.from('client_style_profile').select('*').eq('user_id', userId).maybeSingle(),
        admin.from('user_persona').select('weight').eq('user_id', userId).maybeSingle(),
        admin.from('inspiration_image').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
        admin.from('user_persona_weight_log').select('weight, event_count, created_at').eq('user_id', userId).order('created_at'),
        personaId ? admin.from('stylist').select('name, envelope').eq('stylist_id', personaId).maybeSingle() : Promise.resolve({ data: null }),
      ])

    const envelope = persona?.envelope ?? null
    const uploads = (images ?? []).map((r: any) => {
      const d = envelopeDistance(Array.isArray(r.vector) ? r.vector : null, envelope, CONSTRAINED_DIMS)
      return {
        image_id: r.image_id,
        image_url: r.image_url,
        status: r.status,
        scores: r.scores ?? null,
        corrected_fields: r.corrected_fields ?? [],
        created_at: r.created_at,
        distance: d.total,
        worst: d.worst,
      }
    })

    return {
      profile: normaliseProfile(styleRow),
      uploads,
      weightHistory: history ?? [],
      personaName: persona?.name ?? null,
      weight: assignment?.weight ?? null,
    }
  } catch (err) {
    return { ...empty, error: err instanceof Error ? err.message : 'Load failed' }
  }
}

/** Move a client to a different persona — resets the prior to full strength. */
export async function reassignClientPersona(userId: string, personaId: string): Promise<{ error?: string }> {
  try {
    const admin = createAdminClient() as any
    await admin.from('client_profile').update({ persona_id: personaId }).eq('user_id', userId)
    await admin.from('user_persona').upsert(
      { user_id: userId, persona_id: personaId, weight: PERSONA_START_WEIGHT, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    )
    const { count } = await admin
      .from('taste_event').select('event_id', { count: 'exact', head: true })
      .eq('user_id', userId).neq('event_type', 'inspiration_upload')
    await admin.from('user_persona_weight_log').insert({
      user_id: userId, persona_id: personaId,
      weight: personaWeight(0), event_count: count ?? 0,
    })
    revalidatePath(PATH)
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Reassign failed' }
  }
}
