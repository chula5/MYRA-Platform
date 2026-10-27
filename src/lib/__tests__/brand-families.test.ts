import { describe, it, expect } from 'vitest'
import { BRAND_GROUPS } from '@/app/onboarding/brand-groups'
import { FAMILY_BRACKETS, brandBracket, brandFamily, bracketSpreadViolation, familyFits } from '@/lib/brand-families'

const UNBRACKETED = new Set(['jewellery', 'hats', 'preloved', 'rental'])

describe('brand families', () => {
  it('brackets every brand in every garment, bag and shoe group — and nothing outside it', () => {
    for (const g of BRAND_GROUPS) {
      if (UNBRACKETED.has(g.key)) continue
      const names = [...g.brands, ...(g.more ?? [])]
      expect(Object.keys(FAMILY_BRACKETS[g.key] ?? {}).sort(), g.key).toEqual([...names].sort())
    }
  })

  it('reads brand-table spellings', () => {
    expect(brandFamily('TOTEME')).toBe('quiet_luxury')
    expect(brandFamily('Jil sander')).toBe('quiet_luxury')
    expect(brandFamily('frame-denim')).toBe('denim')
    expect(brandBracket('KHAITE')).toBe(4)
  })

  it('keeps Phoebe Philo with the minimalists, not polished everyday', () => {
    for (const b of ['TOTEME', 'KHAITE', 'Kallmeyer', 'The Row']) expect(familyFits('Phoebe Philo', b, 'bottom'), b).toBe(true)
    expect(familyFits('Phoebe Philo', 'ME+EM', 'bottom')).toBe(false)
    expect(familyFits('Phoebe Philo', 'St. Agni', 'top')).toBe(false) // same family, two brackets down
  })

  it('lets finish families finish any look within a bracket, never dress it', () => {
    expect(familyFits('Phoebe Philo', 'Aeyde', 'shoe')).toBe(true)
    expect(familyFits('Phoebe Philo', 'Polène', 'bag')).toBe(false)
    expect(familyFits('ME+EM', 'Polène', 'bag')).toBe(true)
    expect(familyFits('Phoebe Philo', 'Chan Luu', 'bottom')).toBe(false)
    expect(familyFits('ME+EM', 'A.Emery', 'top')).toBe(false)
    expect(familyFits('ME+EM', 'Agolde', 'bottom')).toBe(true) // denim goes anywhere
  })

  it('holds an unfamilied anchor by bracket only, and keeps unfamilied brands out of familied looks', () => {
    expect(familyFits('Boden', 'ME+EM', 'top')).toBe(true)
    expect(familyFits('ME+EM', 'Boden', 'top')).toBe(false)
  })

  it('refuses a look spread over more than one bracket', () => {
    expect(bracketSpreadViolation(['Phoebe Philo', 'TOTEME', 'Aeyde'])).toBe(false)
    expect(bracketSpreadViolation(['TOTEME', 'The Row', 'Polène'])).toBe(true)
  })
})

describe('brand rows', () => {
  it('reads a brand row by its aliases when the name is the shop’s', () => {
    expect(brandFamily({ name: 'Lisa Yang Store', aliases: ['Lisa Yang'] })).toBe('tailoring')
    expect(brandFamily({ name: 'Lisa Yang Store', aliases: null })).toBe(null)
  })
})
