import { describe, it, expect } from 'vitest'
import { occasionsForMember, CLIENT_OCCASIONS } from '../client-occasions'

describe('occasionsForMember', () => {
  it('drops occasions she never dresses for — Alison does not work', () => {
    const alison = { travel: '1-2 / month', casual_day: 'most days', dinner_drinks: 'weekly' }
    expect(occasionsForMember(alison)).toEqual(['casual_day', 'dinner_drinks', 'travel'])
  })

  it("treats an explicit 'never' the same as not set", () => {
    expect(occasionsForMember({ work_standard: 'never', event: 'weekly' })).toEqual(['event'])
  })

  it('orders by how often, most often first', () => {
    expect(occasionsForMember({ travel: 'most days', casual_day: '1-2 / month', event: 'weekly' }))
      .toEqual(['travel', 'event', 'casual_day'])
  })

  it('offers everything only when no profile exists at all', () => {
    const all = CLIENT_OCCASIONS.map((o) => o.id)
    expect(occasionsForMember({})).toEqual(all)
    expect(occasionsForMember(null)).toEqual(all)
  })
})
