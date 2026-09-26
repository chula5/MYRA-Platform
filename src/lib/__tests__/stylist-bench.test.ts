import { describe, it, expect } from 'vitest'
import { scoreBenchColumn, scoreDistinctness, brandsInStock } from '../stylist-bench'
import { parseBrief } from '../stylist-brief'
import { pairCompat } from '../composer'
import { itemPseudoVector } from '../brand-affinity'
import type { ItemWithBrand } from '../admin-queries'

let seq = 0
function item(item_type: string, item_id: string, over: Record<string, unknown> = {}): ItemWithBrand {
  seq++
  return {
    item_id, item_type, brand_id: `b-${seq}`,
    brand: { brand_id: `b-${seq}`, name: `Brand ${seq}`, price_tier: 3, era_orientation: 3, aesthetic_output: 3, cultural_legibility: 3, creative_behaviour: 3, notes: null },
    product_name: `${item_type} ${item_id}`, retailer_url: 'https://shop.example/x',
    image_url: `https://res.cloudinary.com/x/image/upload/v1/${item_id}.jpg`, price: '180', currency: 'GBP',
    status: 'ready', stock_status: 'in_stock', colour_family: 'navy', colour_hex: '#1d2a44', colour_depth: 2,
    pattern: 1, surface: 1, sheen: 1, fit: 3, structure: 3, material_formality: 3, material_weight: 3,
    material_primary: 'wool', material_category: 'natural_woven', ownership: 'retail',
    ...over,
  } as any
}

const hero = () => item('blouse', 'hero')
const supporting = () => [item('trousers', 'bot'), item('flat', 'shoe'), item('tote', 'bag')]

describe('scoreBenchColumn — the brief', () => {
  it('is not measurable without a brief', () => {
    const s = scoreBenchColumn({ hero: hero(), pieces: supporting(), score: 0.7 })
    expect(s.on_brief).toBeNull()
    expect(s.brand_share).toBeNull()
    expect(s.palette_share).toBeNull()
    expect(s.violations).toEqual([])
  })

  it('reads 50 when the brief does not touch the look', () => {
    const brief = parseBrief({ brands: ['Toteme'], palette: ['cream'], signature_pieces: ['tweed jacket'] }, 'T')
    const s = scoreBenchColumn({ hero: hero(), pieces: supporting(), brief, score: 0.7 })
    expect(s.on_brief).toBe(50)
    expect(s.brief_hits).toBe(0)
    expect(s.brand_share).toBe(0)
    expect(s.palette_share).toBe(0)
  })

  it('reads 100 when every piece is a brand in the brief, and counts the palette', () => {
    const pieces = supporting()
    const brief = parseBrief({ brands: pieces.map((p) => p.brand!.name), palette: ['navy'] }, 'T')
    const s = scoreBenchColumn({ hero: hero(), pieces, brief, score: 0.7 })
    expect(s.on_brief).toBe(100)
    expect(s.brief_hits).toBe(3)
    expect(s.brand_share).toBe(100)
    expect(s.palette_share).toBe(100)
  })

  it('falls below 50 when every piece trips a preference-never, and lists the violations', () => {
    const brief = parseBrief({ nevers: [{ kind: 'preference', text: 'No navy', match: ['navy'] }] }, 'T')
    const s = scoreBenchColumn({ hero: hero(), pieces: supporting(), brief, score: 0.7 })
    expect(s.on_brief).toBe(25)
    expect(s.violations.length).toBe(4) // the hero is navy too, and is judged
    expect(s.hero_banned).toBe(false)
  })

  it('knows when the brief bans the very piece she asked about', () => {
    const brief = parseBrief({ nevers: [{ kind: 'ban', text: 'No blouses', match: ['blouse'] }] }, 'T')
    const s = scoreBenchColumn({ hero: hero(), pieces: supporting(), brief, score: 0.7 })
    expect(s.hero_banned).toBe(true)
  })

  it('palette is not measurable when no piece has a colour', () => {
    const pieces = supporting().map((p) => ({ ...p, colour_family: null }))
    const brief = parseBrief({ palette: ['navy'] }, 'T')
    expect(scoreBenchColumn({ hero: hero(), pieces: pieces as any, brief, score: 0.7 }).palette_share).toBeNull()
  })
})

describe('scoreBenchColumn — occasion, coherence, envelope', () => {
  it('reads the occasion from the type priors alone with no client', () => {
    const occ = { id: 'dinner_drinks', vector: null, climate: null } as any
    const sneaker = scoreBenchColumn({ hero: hero(), pieces: [item('sneaker', 'sn')], occ, score: 0.7 })
    expect(sneaker.occasion).toBe(15)
    expect(sneaker.occasion_avoided).toEqual(['sneaker sn'])
    const heel = scoreBenchColumn({ hero: hero(), pieces: [item('heel', 'hl')], occ, score: 0.7 })
    expect(heel.occasion).toBe(65)
    expect(scoreBenchColumn({ hero: hero(), pieces: [item('heel', 'hl')], score: 0.7 }).occasion).toBeNull()
  })

  it('coherence is the mean pairwise compatibility of the whole look', () => {
    const h = hero()
    const pieces = supporting()
    const all = [h, ...pieces]
    const totals: number[] = []
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) totals.push(pairCompat(all[i], all[j]).total)
    const expected = Math.round((100 * totals.reduce((a, b) => a + b, 0)) / totals.length)
    expect(scoreBenchColumn({ hero: h, pieces, score: 0.7 }).coherence).toBe(expected)
  })

  it('envelope reads 100 at dead centre and counts pieces it cannot see', () => {
    const p = item('trousers', 'bot')
    const centre = itemPseudoVector(p as any)
    const envelope = { mean: centre, spread: centre.map(() => 0) }
    expect(scoreBenchColumn({ hero: hero(), pieces: [p], envelope, score: 0.7 }).envelope).toBe(100)
    const blind = item('trousers', 'bot2', { structure: null, pattern: null, material_formality: null })
    const s = scoreBenchColumn({ hero: hero(), pieces: [blind], envelope, score: 0.7 })
    expect(s.unscored).toBe(1)
    expect(scoreBenchColumn({ hero: hero(), pieces: [p], score: 0.7 }).envelope).toBeNull()
  })
})

describe('scoreDistinctness — how far each column stands from the others', () => {
  const col = (name: string, ids: string[]) => ({
    stylist_name: name,
    pieces: ids.map((id, i) => ({ item_id: id, brand: `Brand ${id}` })),
  })

  it('names twins and gives them no distinctness; a column sharing nothing gets 100', () => {
    const cols = [col('Rosie', ['hero', 'a', 'b', 'c']), col('Clara', ['hero', 'a', 'b', 'c']), col('Ines', ['hero', 'x', 'y', 'z'])]
    const out = scoreDistinctness(cols, 'hero')
    expect(out[0].twins).toEqual(['Clara'])
    expect(out[1].twins).toEqual(['Rosie'])
    expect(out[0].distinct).toBe(0)
    expect(out[2].twins).toEqual([])
    expect(out[2].distinct).toBe(100)
  })

  it('does not count the shared hero as similarity', () => {
    const out = scoreDistinctness([col('Rosie', ['hero', 'a']), col('Clara', ['hero', 'b'])], 'hero')
    expect(out[0].distinct).toBe(100)
    expect(out[0].twins).toEqual([])
  })

  it('is not measurable with a single column', () => {
    expect(scoreDistinctness([col('Rosie', ['hero', 'a'])], 'hero')[0].distinct).toBeNull()
  })
})

describe('brandsInStock', () => {
  it('counts the brief brands the library holds, through spelling', () => {
    const brief = parseBrief({ brands: ['Vanessa Bruno', 'Toteme', 'ME+EM'] }, 'T')
    const pool = [{ brand: { name: 'Vanessabruno' } }, { brand: { name: 'ME+EM' } }, { brand: { name: 'Sessùn' } }]
    expect(brandsInStock(brief, pool)).toBe(2)
    expect(brandsInStock(null, pool)).toBe(0)
  })
})
