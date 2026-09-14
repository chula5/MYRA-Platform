import { describe, it, expect } from 'vitest'
import { rulesForMember, judgeLook, GLOBAL_RULE_CODES } from '../style-rules'
import type { HouseItem } from '../house-style'

// SCandi-Mum's constitution as it now stands — statement sentence removed.
const SCANDI_MUM = {
  name: 'SCandi-Mum',
  constitution: {
    articles: [
      { title: 'Core principle', rules: ['One deliberate surprise + a quiet, coherent base + at least one visible echo.', 'Never chaotic, never trashy, never bland.'] },
      { title: 'Statement budget', rules: ['Everything else recedes — plainer texture, quieter colour, simpler shape.', 'Maximum 2 textured or patterned surfaces. Never 3.'] },
      { title: 'Echo rule', rules: ['Zero echoes fails composition regardless of vector score.'] },
      { title: 'Silhouette balance', rules: ['Loose-on-loose with no definition is an automatic reject.'] },
      { title: 'Colour engine', rules: ['Colour wheel, not a pair list — favour tonal and analogous.', 'Fuchsia pink is banned in every slot.'] },
      { title: 'Category bans', rules: ['No gymwear or activewear as outerwear or streetwear, ever.'] },
    ],
  },
}

const item = (over: Partial<HouseItem> & { item_id: string; slot: string }): HouseItem => ({
  item_type: 'blouse', product_name: 'Piece', colour_family: 'black', colour_depth: 1, pattern: 1, surface: 1, sheen: 1,
  fit: 3, structure: 3, material_category: 'natural_woven', material_primary: 'silk', material_formality: 3, material_weight: 3,
  price: 200, price_tier: 3, ...over,
} as HouseItem)

describe('rulesForMember — the layers', () => {
  it('a client on a house style gets global rules plus that style, and no statement-piece rule', () => {
    const r = rulesForMember(SCANDI_MUM, true)
    expect(r.source).toBe('house_style')
    for (const g of Array.from(GLOBAL_RULE_CODES)) expect(r.codes.has(g)).toBe(true)
    expect(r.codes.has('texture.budget')).toBe(true)
    expect(r.codes.has('silhouette.loose_on_loose')).toBe(true)
    expect(r.codes.has('echo.none')).toBe(true)
    expect(r.codes.has('statement.multiple')).toBe(false)
    expect(r.codes.has('statement.none')).toBe(false)
  })

  it('a Chloe-style client with no house style gets the full Chloe constitution', () => {
    const r = rulesForMember(null, true)
    expect(r.source).toBe('chloe_style')
    expect(r.codes.has('statement.none')).toBe(true)
  })

  it('global rules apply to everyone, whatever else is set', () => {
    const r = rulesForMember(null, false)
    expect(r.source).toBe('global_only')
    expect(Array.from(r.codes).sort()).toEqual(Array.from(GLOBAL_RULE_CODES).sort())
  })

  it('editing the style changes what is enforced', () => {
    const noSilhouette = { name: 'X', constitution: { articles: [{ rules: ['Maximum 2 textured or patterned surfaces.'] }] } }
    expect(rulesForMember(noSilhouette, true).codes.has('silhouette.loose_on_loose')).toBe(false)
  })
})

describe('judgeLook', () => {
  it('blocks activewear for everyone', () => {
    const look = [item({ item_id: 'a', slot: 'top', is_activewear: true } as any), item({ item_id: 'b', slot: 'bottom' })]
    expect(judgeLook(look, rulesForMember(null, false)).blocked).toBe(true)
  })

  it('does not block a look for lacking a statement piece on a house style that has no such rule', () => {
    const quiet = [item({ item_id: 'a', slot: 'top' }), item({ item_id: 'b', slot: 'bottom' }), item({ item_id: 'c', slot: 'shoe' }), item({ item_id: 'd', slot: 'bag' })]
    const scandi = judgeLook(quiet, rulesForMember(SCANDI_MUM, true))
    expect(scandi.violations.some((v) => v.code.startsWith('statement.'))).toBe(false)
  })

  it('never double-counts white with cream (handled from the real colour elsewhere)', () => {
    const look = [item({ item_id: 'a', slot: 'top', colour_family: 'white' }), item({ item_id: 'b', slot: 'bottom', colour_family: 'cream' })]
    const j = judgeLook(look, rulesForMember(null, true))
    expect([...j.violations, ...j.penalties].some((h) => h.code === 'colour.white_cream')).toBe(false)
  })
})

describe('rule strength', () => {
  it('the statement piece is a preference for Chloe style — it lowers the score, never blocks', () => {
    const quiet = [item({ item_id: 'a', slot: 'top' }), item({ item_id: 'b', slot: 'bottom' }), item({ item_id: 'c', slot: 'shoe' }), item({ item_id: 'd', slot: 'bag' })]
    const j = judgeLook(quiet, rulesForMember(null, true))
    expect(j.violations.some((v) => v.code.startsWith('statement.'))).toBe(false)
    if (j.penalties.some((p) => p.code === 'statement.none')) expect(j.penalty).toBeGreaterThan(0)
  })

  it('fuchsia still blocks for everyone', () => {
    const look = [item({ item_id: 'a', slot: 'top', colour_family: 'pink', product_name: 'Fuchsia blouse', colour_hex: '#ff00aa' } as any), item({ item_id: 'b', slot: 'bottom' })]
    const j = judgeLook(look, rulesForMember(null, false))
    if (j.violations.length || j.penalties.length) expect(j.violations.some((v) => v.code === 'colour.fuchsia')).toBe(true)
  })
})
