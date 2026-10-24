import { describe, it, expect } from 'vitest'
import { namedBrands, newInMessage, newInPath } from '../new-in'
import { apnsPayload } from '../push/apns'

describe('namedBrands', () => {
  it('keeps her order and drops input-only and not-for-me brands', () => {
    const m = {
      member_id: 'm',
      brands: [{ name: 'Sessùn', rank: 2 }, { name: 'ME+EM', rank: 1 }, { name: 'Zara', rank: 3 }, { name: 'Toteme', rank: 4 }],
      brands_input_only: ['zara'],
      brands_never: ['TOTEME'],
    }
    expect(namedBrands(m)).toEqual(['ME+EM', 'Sessùn'])
  })
  it('is empty when she has named none', () => {
    expect(namedBrands({ member_id: 'm', brands: null })).toEqual([])
  })
})

describe('newInMessage', () => {
  it('says nothing when nothing is new', () => {
    expect(newInMessage([])).toBeNull()
  })
  it('names the one brand', () => {
    expect(newInMessage([{ brand_id: 'a', name: 'ME+EM', count: 6 }])).toEqual({
      title: 'New in from ME+EM', body: '6 new pieces in your size this week.',
    })
    expect(newInMessage([{ brand_id: 'a', name: 'ME+EM', count: 1 }])?.body).toBe('1 new piece in your size this week.')
  })
  it('names the two biggest, then counts the rest', () => {
    const r = newInMessage([
      { brand_id: 'a', name: 'Antik Batik', count: 15 },
      { brand_id: 'b', name: 'Liffner', count: 1 },
      { brand_id: 'c', name: 'ME+EM', count: 82 },
      { brand_id: 'd', name: 'SOEUR', count: 7 },
    ])
    expect(r?.body).toBe('105 new pieces in your size this week: 82 from ME+EM, 15 from Antik Batik and 2 more of your brands.')
  })
  it('two brands read as a pair', () => {
    const r = newInMessage([{ brand_id: 'a', name: 'ME+EM', count: 84 }, { brand_id: 'b', name: 'Sessùn', count: 40 }])
    expect(r?.body).toBe('124 new pieces in your size this week: 84 from ME+EM and 40 from Sessùn.')
  })
})

describe('the push itself', () => {
  it('opens Browse on the week', () => {
    expect(newInPath('2026-10-19T09:00:00.000Z')).toBe('/me/browse?new=2026-10-19T09%3A00%3A00.000Z')
  })
  it('carries the page to open beside the alert', () => {
    expect(JSON.parse(apnsPayload({ title: 'New in from ME+EM', body: '6 new pieces', url: '/me/browse?new=x' }))).toEqual({
      aps: { alert: { title: 'New in from ME+EM', body: '6 new pieces' }, sound: 'default' },
      url: '/me/browse?new=x',
    })
  })
})
