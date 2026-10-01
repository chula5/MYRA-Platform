// Connected proof for the REAL snapshot adapter against the connected MYRA
// Platform project. Read-only: no row is inserted, updated, or deleted, so no
// cleanup is required and no non-test data is touched.
//
// Proven here, against the production adapter and the live database:
//  1. A real non-Chloe stylist's learned model is loaded from `stylist_model`
//     by exact stylist id and matches the live row (or is explicitly absent
//     when the stylist has no own model row).
//  2. The fallback-aware path (`loadStyleModel`, `getStylistBySlug`,
//     `resolveStylistId`) is never invoked — the spies throw if it is — so a
//     non-Chloe snapshot performs zero Chloe loader calls.
//  3. An absent own model freezes as an explicit `status: 'absent'`
//     representation in the canonical payload, never a borrowed substitute.
//
// The suite self-skips when Supabase env is unavailable (e.g. CI without
// `.env.local`); locally it runs as part of `npm test`.

import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

function ensureEnv(): boolean {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const text = readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf8')
      for (const line of text.split('\n')) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
        if (!m) continue
        if (!(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
      }
    } catch {
      // No env file — the suite skips below.
    }
  }
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
}

const CONNECTED = ensureEnv()

const fallbackSpies = vi.hoisted(() => ({
  getStylistBySlug: vi.fn(() => {
    throw new Error('forbidden in the snapshot path: getStylistBySlug (Chloe fallback)')
  }),
  resolveStylistId: vi.fn(() => {
    throw new Error('forbidden in the snapshot path: resolveStylistId (default resolution)')
  }),
  loadStyleModel: vi.fn(() => {
    throw new Error('forbidden in the snapshot path: fallback-aware loadStyleModel')
  }),
}))

vi.mock('@/lib/stylist-store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/stylist-store')>()),
  getStylistBySlug: fallbackSpies.getStylistBySlug,
  resolveStylistId: fallbackSpies.resolveStylistId,
}))

vi.mock('@/lib/style-brain-store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/style-brain-store')>()),
  loadStyleModel: fallbackSpies.loadStyleModel,
}))

import { createAdminClient } from '@/lib/supabase-server'
import { createSupabaseStylistSnapshotLoader } from '@/lib/outfit-quality/stylist-snapshot-store'
import { buildSnapshotPayload } from '@/lib/outfit-quality/stylist-snapshot'
import { CHLOE_STYLIST_ID } from '@/lib/outfit-quality/identities'

const T = { timeout: 30000 }

describe.skipIf(!CONNECTED)('connected real-adapter proof (read-only)', () => {
  it('loads a real non-Chloe stylist and its own model by exact id, with zero Chloe loader calls', T, async () => {
    const admin = createAdminClient()
    const db = admin as any

    const { data: stylists, error } = await db
      .from('stylist')
      .select('stylist_id, slug, name')
      .neq('stylist_id', CHLOE_STYLIST_ID)
      .limit(10)
    expect(error).toBeNull()
    expect(stylists?.length).toBeGreaterThan(0)
    const target = stylists[0]

    const loader = createSupabaseStylistSnapshotLoader(admin)

    // The stylist itself loads by exact id.
    const loaded = await loader.loadStylist(target.stylist_id)
    expect(loaded?.stylist_id).toBe(target.stylist_id)
    expect(loaded?.slug).toBe(target.slug)

    // The learned model matches the live stylist_model row exactly.
    const { data: modelRow, error: modelErr } = await db
      .from('stylist_model')
      .select('model, decisions')
      .eq('stylist_id', target.stylist_id)
      .maybeSingle()
    expect(modelErr).toBeNull()

    const model = await loader.loadLearnedModel(target.stylist_id)
    expect(model.present).toBe(!!modelRow)
    if (modelRow) {
      expect(model.payload).toEqual(modelRow.model)
      expect(model.decisionCount).toBe(modelRow.decisions)
    }

    // Mask and inspiration reads succeed and are scoped to this stylist.
    const [mask, inspiration] = await Promise.all([
      loader.loadItemMask(target.stylist_id),
      loader.loadConfirmedInspiration(target.stylist_id),
    ])
    expect(Array.isArray(mask)).toBe(true)
    expect(Array.isArray(inspiration)).toBe(true)
    for (const img of inspiration) expect(img.status).toBe('confirmed')

    // Zero Chloe loader calls anywhere in the real adapter.
    expect(fallbackSpies.getStylistBySlug).not.toHaveBeenCalled()
    expect(fallbackSpies.resolveStylistId).not.toHaveBeenCalled()
    expect(fallbackSpies.loadStyleModel).not.toHaveBeenCalled()
  })

  it('represents an absent own model explicitly against the live database', T, async () => {
    const admin = createAdminClient()
    const loader = createSupabaseStylistSnapshotLoader(admin)

    // A well-formed stylist id with no stylist_model row: the live read finds
    // nothing and the adapter must say so explicitly instead of falling back.
    const absentId = '00000000-0000-4000-8000-0000000000ab'
    const model = await loader.loadLearnedModel(absentId)
    expect(model).toEqual({ present: false, payload: null, version: null, decisionCount: 0 })

    // The explicit absence freezes into the canonical payload as-is.
    const payload = buildSnapshotPayload({
      stylist: {
        stylist_id: absentId,
        slug: 'no-model-stylist',
        name: 'No Model Stylist',
        status: 'live',
        constitution_version: null,
        constitution: null,
        brief: {
          public_name: 'No Model Stylist',
          tagline: '',
          image_url: null,
          signature_pieces: [],
          brands: [],
          palette: [],
          fabrics: [],
          day: null,
          evening: null,
          weekend: null,
          nevers: [],
          siblings: [],
          how_she_routes: null,
        } as never,
        voice_notes: null,
        envelope: null,
        envelope_status: null,
        envelope_computed_at: null,
      },
      itemMask: [],
      learnedModel: model,
      confirmedInspiration: [],
    })
    expect(payload.learned_model).toEqual({ status: 'absent', payload: null, version: null, decision_count: 0 })

    expect(fallbackSpies.getStylistBySlug).not.toHaveBeenCalled()
    expect(fallbackSpies.resolveStylistId).not.toHaveBeenCalled()
    expect(fallbackSpies.loadStyleModel).not.toHaveBeenCalled()
  })

  it('resolves an unknown stylist id to null with no fallback lookup', T, async () => {
    const admin = createAdminClient()
    const loader = createSupabaseStylistSnapshotLoader(admin)
    await expect(loader.loadStylist('00000000-0000-4000-8000-0000000000ff')).resolves.toBeNull()
    expect(fallbackSpies.getStylistBySlug).not.toHaveBeenCalled()
    expect(fallbackSpies.resolveStylistId).not.toHaveBeenCalled()
  })
})
