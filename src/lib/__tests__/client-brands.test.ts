// The matching rules behind a client naming her own brands.
//
// Every one of these is a case where naming a brand LOOKS like it worked and
// silently does not: the name resolves to nothing, or to the wrong thing, or
// to a brand that can never be sent to her. The picker, the composer and the
// delivery gate all have to agree, and they only agree because they fold names
// through the same key.

import { describe, it, expect } from 'vitest'
import { brandKey, resolveBrandNames, type BrandGraph, type BrandLite } from '@/lib/brand-affinity'
import { isFastFashion } from '@/lib/pilot-stylist'

const brand = (name: string, aliases: string[] = [], over: Partial<BrandLite> = {}): BrandLite => ({
  brand_id: `id-${brandKey(name).replace(/\s/g, '-')}`,
  name,
  aliases,
  price_tier: 3,
  status: 'stocked',
  brand_vector: null,
  vector_item_count: 10,
  median_price_overall: 200,
  median_price_by_category: null,
  core_category: null,
  price_position: null,
  codes: null,
  ...over,
})

const graphOf = (brands: BrandLite[]): BrandGraph => ({
  brands,
  byId: new Map(brands.map((b) => [b.brand_id, b])),
  families: [],
  memberships: [],
  exclusions: [],
  config: { bandBounds: [50, 100, 250, 500, 1000], priceK: 1 },
})

describe('folding a typed brand name', () => {
  it('ignores case and spacing, so "  toteme " is Totême', () => {
    expect(brandKey('  toteme ')).toBe(brandKey('Totême'))
  })

  it('ignores accents — the single most common way a real brand goes missing', () => {
    expect(brandKey('Sessun')).toBe(brandKey('Sessùn'))
    expect(brandKey('Chloe')).toBe(brandKey('Chloé'))
  })

  it('reads & and "and" as the same word', () => {
    expect(brandKey('Dolce & Gabbana')).toBe(brandKey('Dolce and Gabbana'))
  })

  it('reads punctuation as a word break, so "ME+EM" is "me em"', () => {
    expect(brandKey('ME+EM')).toBe(brandKey('me em'))
    expect(brandKey('J.Crew')).toBe(brandKey('j crew'))
  })

  it('does NOT collapse punctuation away — "APC" is not "A.P.C"', () => {
    // Worth pinning down, because it is the reason brand.aliases exists: the
    // key turns dots into spaces rather than deleting them, so a client typing
    // the run-together spelling reaches the brand only if it is listed as an
    // alias. A brand whose common spelling differs from its display name needs
    // that alias, or she will name it and match nothing.
    expect(brandKey('A.P.C')).not.toBe(brandKey('APC'))
  })

  it('is empty for something that is not a name', () => {
    expect(brandKey('   ')).toBe('')
    expect(brandKey('!!!')).toBe('')
  })
})

describe('resolving what she typed against what MYRA stocks', () => {
  const graph = graphOf([
    brand('Sessùn'),
    brand('Totême'),
    brand('ME+EM'),
    brand('A.P.C', ['APC', 'Atelier de Production et de Création']),
  ])

  it('finds a brand she typed without its accent', () => {
    const { matched, unmatched } = resolveBrandNames(graph, ['Sessun'])
    expect(matched.map((b) => b.name)).toEqual(['Sessùn'])
    expect(unmatched).toEqual([])
  })

  it('finds a brand by an alias, not just its display name', () => {
    const { matched } = resolveBrandNames(graph, ['APC'])
    expect(matched.map((b) => b.name)).toEqual(['A.P.C'])
  })

  it('reports a brand MYRA has never heard of instead of dropping it', () => {
    // This is the case that becomes a request her stylist sees.
    const { matched, unmatched } = resolveBrandNames(graph, ['Khaite'])
    expect(matched).toEqual([])
    expect(unmatched).toEqual(['Khaite'])
  })

  it('counts one brand once, however many ways she spells it', () => {
    const { matched } = resolveBrandNames(graph, ['Sessun', 'Sessùn', 'SESSUN'])
    expect(matched).toHaveLength(1)
  })

  it('keeps the real ones when only some of a list are known', () => {
    const { matched, unmatched } = resolveBrandNames(graph, ['Totême', 'Some Shop', 'ME+EM'])
    expect(matched.map((b) => b.name).sort()).toEqual(['ME+EM', 'Totême'])
    expect(unmatched).toEqual(['Some Shop'])
  })
})

describe('the Zara rule', () => {
  // Fast fashion is legitimate taste signal and legitimate wardrobe, but a look
  // containing it fails validateDelivery outright. Naming it has to land in the
  // input-only list, or she would add it, see nothing, and never be told why.
  it('recognises fast fashion whatever the casing or accent', () => {
    expect(isFastFashion('Zara')).toBe(true)
    expect(isFastFashion('ZARA')).toBe(true)
    expect(isFastFashion('  mango  ')).toBe(true)
    expect(isFastFashion('H&M')).toBe(true)
  })

  it('leaves the brands she can actually be sent alone', () => {
    expect(isFastFashion('Totême')).toBe(false)
    expect(isFastFashion('Sessùn')).toBe(false)
    expect(isFastFashion('ME+EM')).toBe(false)
  })
})

describe('what the picker may offer', () => {
  // A brand marked 'reference' exists to position other brands in taste space;
  // MYRA cannot shop it. Offering it as a favourite would put a dead name in
  // her list that looks exactly like a working one.
  it('treats a reference brand as not stocked', () => {
    const graph = graphOf([brand('Totême'), brand('The Row', [], { status: 'reference' })])
    const stocked = new Set<string>()
    for (const b of graph.brands) {
      if (b.status !== 'stocked') continue
      stocked.add(brandKey(b.name))
      for (const a of b.aliases) stocked.add(brandKey(a))
    }
    expect(stocked.has(brandKey('Totême'))).toBe(true)
    expect(stocked.has(brandKey('The Row'))).toBe(false)
  })

  it('still resolves a reference brand, so naming it is not recorded as unknown', () => {
    // It matches a real row, so it is not a stocking request — it just cannot
    // be shopped yet. The two states are different and are shown differently.
    const graph = graphOf([brand('The Row', [], { status: 'reference' })])
    const { matched, unmatched } = resolveBrandNames(graph, ['The Row'])
    expect(matched).toHaveLength(1)
    expect(unmatched).toEqual([])
  })
})
