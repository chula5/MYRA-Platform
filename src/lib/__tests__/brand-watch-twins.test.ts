import { describe, it, expect } from 'vitest'
import { carefulFlags, keptTwinOf, measureTwinTrust, type TwinDecision } from '../brand-watch-twins'

let n = 0
const at = () => new Date(Date.UTC(2026, 8, 1) + ++n * 60_000).toISOString()
const d = (name: string, kept: boolean, extra: Partial<TwinDecision> = {}): TwinDecision => ({
  item_id: `q${++n}`, brand_name: 'sessun', product_name: name, item_type: 'skirt', colour_family: 'cream',
  material_category: 'natural_woven', price: '150', kept, at: at(), ...extra,
})

describe('keptTwinOf', () => {
  it('finds the same design she kept, in another colour', () => {
    const earlier = [d('Dagny Skirt - Black', true)]
    expect(keptTwinOf(d('Dagny Skirt - Indigo', true), earlier, carefulFlags(earlier))?.product_name).toBe('Dagny Skirt - Black')
  })

  it('is blocked by a twin she skipped', () => {
    const earlier = [d('Dagny Skirt - Black', true), d('Dagny Skirt - Fuchsia', false)]
    expect(keptTwinOf(d('Dagny Skirt - Indigo', true), earlier, carefulFlags(earlier))).toBeNull()
  })

  it('does not count a bulk keep as evidence', () => {
    const bulk = new Date(Date.UTC(2026, 8, 2)).toISOString()
    const earlier = [0, 1, 2, 3, 4].map((i) => d(`Dagny Skirt - ${i}`, true, { at: bulk }))
    expect(keptTwinOf(d('Dagny Skirt - Indigo', true), earlier, carefulFlags(earlier))).toBeNull()
  })

  it('does not count its own automatic keeps as evidence', () => {
    const earlier = [d('Dagny Skirt - Black', true, { autoKept: true })]
    expect(keptTwinOf(d('Dagny Skirt - Indigo', true), earlier, carefulFlags(earlier))).toBeNull()
  })

  it('never matches across brands or kinds of piece', () => {
    const earlier = [d('Dagny Skirt - Black', true)]
    expect(keptTwinOf(d('Dagny Skirt - Indigo', true, { brand_name: 'wyse' }), earlier, carefulFlags(earlier))).toBeNull()
    expect(keptTwinOf(d('Dagny Coat', true, { item_type: 'coat' }), earlier, carefulFlags(earlier))).toBeNull()
  })
})

describe('measureTwinTrust', () => {
  it('trusts a brand whose twins she keeps', () => {
    const ds = ['Black', 'Indigo', 'Stone', 'Olive', 'Rust', 'Navy', 'Sand'].map((c) => d(`Dagny Skirt - ${c}`, true))
    const t = measureTwinTrust(ds).get('sessun')!
    expect(t.predictions).toBe(6)
    expect(t.trusted).toBe(true)
  })

  it('does not trust a brand whose twins she often skips', () => {
    const ds = [
      d('Mona Trouser - Black', true), d('Mona Trouser - Grey', true), d('Mona Trouser - Red', false),
      d('Lina Shirt - White', true, { item_type: 'shirt' }), d('Lina Shirt - Blue', true, { item_type: 'shirt' }),
      d('Lina Shirt - Pink', false, { item_type: 'shirt' }), d('Ada Knit - Cream', true, { item_type: 'knitwear' }),
      d('Ada Knit - Yellow', false, { item_type: 'knitwear' }),
    ]
    expect(measureTwinTrust(ds).get('sessun')!.trusted).toBe(false)
  })
})
