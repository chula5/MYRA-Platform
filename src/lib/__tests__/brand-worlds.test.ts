import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/size-availability', () => ({
  loadMemberSizeProfile: async () => ({ profile: null }),
  loadSizeRowsFor: async () => new Map(),
  filterItemsForShopper: async (items: any[]) => items,
}))

import {
  maybeBrandsFor, tookWholeWorld, worldNames, worldOf, bracketFromMedian, bracketFits, MAYBE_IGNORES,
  type WorldBrand,
} from '@/lib/brand-worlds'
import { brandKey } from '@/lib/brand-affinity'
import { searchForMember } from '@/lib/member-search'

// ── The pure rules ──────────────────────────────────────────────────────────

const B = (brand_id: string, name: string, extra: Partial<WorldBrand> = {}): WorldBrand => ({ brand_id, name, status: 'stocked', ...extra })

const brands: WorldBrand[] = [
  B('farm', 'Farm Rio'), B('withjean', 'With Jéan'), // Colour & print, brackets 2 and 1
  B('sj', 'Sister Jane'), B('rixo', 'Rixo'), B('etro', 'Etro'), B('ganni', 'Ganni'), B('damson', 'Damson Madder'),
  B('erdem', 'Erdem'), B('zimm', 'Zimmermann'), // Romance & occasion: a world she never touched
  B('newbie', 'Newbie Label', { picker_group: 'contemporary' }), // filed by placement
  B('gone', 'Stine Goya', { status: 'pending' }),
]

describe('quiet maybes: the other brands in the worlds she loves', () => {
  const base = { brands, loved: ['farm', 'withjean'], inGraph: new Set<string>(), turnedDown: new Set<string>(), ignored: new Set<string>() }

  it('Sister Jane is a maybe for a Farm Rio woman, labelled by the brand she loves', () => {
    const m = maybeBrandsFor(base)
    // Farm Rio first in her list, but With Jéan sits at Sister Jane's price: named for the nearer one.
    expect(m.get('sj')).toEqual({ group: 'contemporary', like: 'With Jéan' })
    expect(m.get('rixo')?.like).toBe('Farm Rio')
    expect(m.has('rixo')).toBe(true)
    expect(m.has('newbie')).toBe(true) // filed into the world since
  })

  it('a world she ignored entirely is left out', () => {
    const m = maybeBrandsFor(base)
    expect(m.has('erdem')).toBe(false)
    expect(m.has('zimm')).toBe(false)
  })

  it('never, input-only and hidden are hard noes; scrolled past too often drops out', () => {
    const m = maybeBrandsFor({ ...base, turnedDown: new Set(['sj']), ignored: new Set(['rixo']) })
    expect(m.has('sj')).toBe(false)
    expect(m.has('rixo')).toBe(false)
    expect(m.has('ganni')).toBe(true)
  })

  it('her own brands and her graph are answers already, never maybes; unstocked is never offered', () => {
    const m = maybeBrandsFor({ ...base, inGraph: new Set(['ganni']) })
    expect(m.has('farm')).toBe(false)
    expect(m.has('ganni')).toBe(false)
    expect(m.has('gone')).toBe(false)
  })

  it('price bracket: within one of what she loves in that world', () => {
    // She loves only Sister Jane (high street, 1): Etro (luxury, 4) is out, Rixo (2) is in.
    const m = maybeBrandsFor({ ...base, loved: ['sj'] })
    expect(m.has('etro')).toBe(false)
    expect(m.has('rixo')).toBe(true)
    expect(m.has('damson')).toBe(true)
    expect(bracketFits(4, [1])).toBe(false)
    expect(bracketFits(2, [1])).toBe(true)
    expect(bracketFits(null, [1])).toBe(true)
  })

  it('reads a world off the authored groups first, then the placement', () => {
    expect(worldOf({ name: 'Sister Jane' })).toBe('contemporary')
    expect(worldOf({ name: 'Newbie', picker_group: 'parisian' })).toBe('parisian')
    expect(worldOf({ name: 'Nobody', picker_group: 'none' })).toBe(null)
  })

  it('a bracket from a median price, calibrated on real labels', () => {
    expect(bracketFromMedian(111)).toBe(1) // Jigsaw
    expect(bracketFromMedian(250)).toBe(2) // ME+EM
    expect(bracketFromMedian(386)).toBe(3) // Isabel Marant
    expect(bracketFromMedian(1457)).toBe(4) // The Row
    expect(bracketFromMedian(null)).toBe(null)
  })
})

describe('a whole world, for new brands to join', () => {
  const names = worldNames('hats')
  const keys = (xs: string[]) => new Set(xs.map(brandKey))

  it('every brand loved or never is a whole world; one left open is not', () => {
    expect(tookWholeWorld(names, keys(names), new Set())).toBe(true)
    expect(tookWholeWorld(names, keys(names.slice(1)), keys(names.slice(0, 1)))).toBe(true)
    expect(tookWholeWorld(names, keys(names.slice(1)), new Set())).toBe(false)
  })

  it('a world of nevers is one she turned down', () => {
    expect(tookWholeWorld(names, new Set(), keys(names))).toBe(false)
  })

  it('brands filed into the world since count as part of it', () => {
    const all = worldNames('hats', [{ name: 'New Milliner', picker_group: 'hats' }, { name: 'Elsewhere', picker_group: 'shoes' }])
    expect(all).toContain('New Milliner')
    expect(all).not.toContain('Elsewhere')
    expect(tookWholeWorld(all, keys(names), new Set())).toBe(false)
  })
})

// ── Browse, end to end over an in-memory catalogue ──────────────────────────

/** Just enough of PostgREST for searchForMember: eq/in/gt/gte/lte/ilike filter; or() is permissive (the scorer decides). */
function fakeAdmin(tables: Record<string, any[]>) {
  const from = (table: string) => {
    let rows = [...(tables[table] ?? [])]
    const q: any = {
      select: () => q,
      eq: (c: string, v: any) => { rows = rows.filter((r) => r[c] === v); return q },
      neq: (c: string, v: any) => { rows = rows.filter((r) => r[c] !== v); return q },
      in: (c: string, vs: any[]) => { rows = rows.filter((r) => vs.includes(r[c])); return q },
      not: (c: string, op: string, v: any) => { if (op === 'is' && v === null) rows = rows.filter((r) => r[c] != null); return q },
      is: (c: string, v: any) => { rows = rows.filter((r) => r[c] === v); return q },
      gt: (c: string, v: any) => { rows = rows.filter((r) => Number(r[c]) > v); return q },
      gte: (c: string, v: any) => { rows = rows.filter((r) => r[c] != null && r[c] >= v); return q },
      lte: (c: string, v: any) => { rows = rows.filter((r) => r[c] != null && r[c] <= v); return q },
      ilike: (c: string, pat: string) => { const w = pat.replace(/%/g, '').toLowerCase(); rows = rows.filter((r) => String(r[c] ?? '').toLowerCase().includes(w)); return q },
      or: (expr: string) => {
        // The affinity read: above the baseline, hidden, or saved.
        if (/affinity\.gt/.test(expr)) rows = rows.filter((r) => r.affinity > 0.1 || r.hidden || r.positive_count > 0)
        return q
      },
      order: () => q,
      limit: () => q,
      maybeSingle: async () => ({ data: rows[0] ?? null }),
      then: (res: any, rej: any) => Promise.resolve({ data: rows }).then(res, rej),
    }
    return q
  }
  return { from }
}

const piece = (item_id: string, brand_id: string, brandName: string, product_name: string, price_gbp: number, extra: any = {}) => ({
  item_id, brand_id, product_name, price_gbp, image_url: `https://img/${item_id}.jpg`, retailer_url: `https://shop/${item_id}`,
  item_type: 'mini_dress', colour_family: 'multicolour', material_primary: 'Jacquard with faux fur trim',
  status: 'ready', stock_status: 'in_stock', available: true, created_at: '2026-11-01',
  brand: { name: brandName, source_type: null, size_offset: null }, ...extra,
})

describe('Browse offers her quiet maybes after her own brands, exact, in budget', () => {
  const MEMBER = 'chloe'
  let tables: Record<string, any[]>

  beforeEach(() => {
    tables = {
      brand: [
        { brand_id: 'farm', name: 'Farm Rio', aliases: [], status: 'stocked', picker_group: null },
        { brand_id: 'sj', name: 'Sister Jane', aliases: [], status: 'stocked', picker_group: null },
        { brand_id: 'rixo', name: 'Rixo', aliases: [], status: 'stocked', picker_group: null },
        { brand_id: 'ganni', name: 'Ganni', aliases: [], status: 'stocked', picker_group: null },
        { brand_id: 'etro', name: 'Etro', aliases: [], status: 'stocked', picker_group: null },
        { brand_id: 'erdem', name: 'Erdem', aliases: [], status: 'stocked', picker_group: null },
      ],
      pilot_member: [{
        member_id: MEMBER, brands: [{ name: 'Farm Rio', rank: 1 }], brands_input_only: [], brands_never: ['Ganni'],
        price_bands: { dress: { max: 400 } },
      }],
      user_brand_affinity: [
        { user_id: MEMBER, brand_id: 'sj', affinity: 0.1, hidden: false, positive_count: 0, skip_count: 0 },
        { user_id: MEMBER, brand_id: 'rixo', affinity: 0.1, hidden: false, positive_count: 0, skip_count: 0 },
      ],
      item: [
        piece('farm1', 'farm', 'Farm Rio', 'Farm Rio faux fur trim mini dress', 220),
        piece('sj1', 'sj', 'Sister Jane', 'Dream faux fur trim scoop neck mini dress', 165),
        piece('rixo-over', 'rixo', 'Rixo', 'Rixo fur trim mini dress', 450), // over her £400 dress band
        piece('rixo-plain', 'rixo', 'Rixo', 'Rixo poplin mini dress', 200, { material_primary: 'Cotton poplin' }), // not fur trim
        piece('ganni1', 'ganni', 'Ganni', 'Ganni fur trim mini dress', 180), // never
        piece('etro1', 'etro', 'Etro', 'Etro fur trim mini dress', 390), // bracket 4 vs her 2
        piece('erdem1', 'erdem', 'Erdem', 'Erdem fur trim mini dress', 350), // a world she never touched
      ],
    }
  })

  it('"fur trim dress" returns Sister Jane after Farm Rio, labelled, and nothing she would not have', async () => {
    const view = await searchForMember(fakeAdmin(tables), MEMBER, 'fur trim dress', {}, { maybe: true })
    const ids = view.pieces.map((p) => p.item_id)
    expect(ids[0]).toBe('farm1')
    expect(ids).toContain('sj1')
    expect(ids.indexOf('sj1')).toBeGreaterThan(ids.indexOf('farm1'))
    expect(view.pieces.find((p) => p.item_id === 'sj1')?.like).toBe('Farm Rio')
    expect(view.pieces.find((p) => p.item_id === 'farm1')?.like).toBeUndefined()
    for (const no of ['rixo-over', 'rixo-plain', 'ganni1', 'etro1', 'erdem1']) expect(ids, no).not.toContain(no)
    expect(view.maybeShown).toEqual(['Sister Jane'])
  })

  it('ABOVE MY BUDGET never lifts a maybe over her ceiling', async () => {
    const view = await searchForMember(fakeAdmin(tables), MEMBER, 'fur trim dress', { aboveBudget: true }, { maybe: true })
    expect(view.pieces.map((p) => p.item_id)).not.toContain('rixo-over')
  })

  it('no maybes unless Browse asks: saved-search notes, the MCP and the cron never get them', async () => {
    const view = await searchForMember(fakeAdmin(tables), MEMBER, 'fur trim dress')
    expect(view.pieces.map((p) => p.item_id)).toEqual(['farm1'])
  })

  it(`scrolled past ${MAYBE_IGNORES} times with no save, the maybe drops out`, async () => {
    tables.user_brand_affinity[0].skip_count = MAYBE_IGNORES
    const view = await searchForMember(fakeAdmin(tables), MEMBER, 'fur trim dress', {}, { maybe: true })
    expect(view.pieces.map((p) => p.item_id)).not.toContain('sj1')
  })

  it('a save promotes it: now one of hers, no longer labelled a maybe', async () => {
    Object.assign(tables.user_brand_affinity[0], { affinity: 0.15, positive_count: 1, skip_count: MAYBE_IGNORES })
    const view = await searchForMember(fakeAdmin(tables), MEMBER, 'fur trim dress', {}, { maybe: true })
    const sj = view.pieces.find((p) => p.item_id === 'sj1')
    expect(sj).toBeTruthy()
    expect(sj?.like).toBeUndefined()
  })

  it('naming a label searches that label only — no maybes beside it', async () => {
    const view = await searchForMember(fakeAdmin(tables), MEMBER, 'farm rio fur trim dress', {}, { maybe: true })
    expect(view.pieces.some((p) => p.like)).toBe(false)
  })
})
