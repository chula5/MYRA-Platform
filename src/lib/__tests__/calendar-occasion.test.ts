import { describe, expect, it } from 'vitest'
import { readCalendarOccasion } from '@/lib/calendar/occasion'

describe('readCalendarOccasion — most of a calendar is not an outfit', () => {
  it('finds the things worth dressing for', () => {
    expect(readCalendarOccasion("Sophie & Tom's wedding")?.occasion).toBe('event')
    expect(readCalendarOccasion('Dinner with the Hendersons', 'The River Café')?.occasion).toBe('dinner_drinks')
    expect(readCalendarOccasion('Flight to Athens')?.occasion).toBe('travel')
    expect(readCalendarOccasion('Client meeting: Q3 pitch')?.occasion).toBe('work_elevated')
    expect(readCalendarOccasion("Mum's 70th birthday lunch")?.occasion).toBe('event')
    expect(readCalendarOccasion('School sports day')?.occasion).toBe('casual_day')
  })
  it('leaves the rest out', () => {
    for (const t of ['Dentist', 'Bin day', 'Zoom with accountant', 'Pilates', 'Boiler service', 'Pay council tax', 'School run']) {
      expect(readCalendarOccasion(t), t).toBeNull()
    }
  })
  it('a dressy word wins over an errand in the same title', () => {
    expect(readCalendarOccasion('Dinner after the dentist')?.occasion).toBe('dinner_drinks')
  })
})
