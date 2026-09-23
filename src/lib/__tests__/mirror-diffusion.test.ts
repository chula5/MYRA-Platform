import { describe, expect, it } from 'vitest'
import { houseForLine } from '@/lib/mirror/diffusion'

const houses = ['Isabel Marant', 'Ralph Lauren', 'The Row', 'Ganni', 'Ba&sh', 'Sessùn']

describe('houseForLine — retailer line labels resolve to the house she named', () => {
  it('Sign of the Times spellings of Étoile', () => {
    expect(houseForLine('Isabel Marant Etoile', houses)?.house).toBe('Isabel Marant')
    expect(houseForLine('Isabel marant Etoile', houses)?.house).toBe('Isabel Marant')
    expect(houseForLine('Isabel Marant Étoile', houses)?.house).toBe('Isabel Marant')
    expect(houseForLine('Étoile Isabel Marant', houses)?.house).toBe('Isabel Marant')
    expect(houseForLine('Marant Étoile', houses)).toEqual({ house: 'Isabel Marant', via: 'short' })
    expect(houseForLine('Marant', houses)).toEqual({ house: 'Isabel Marant', via: 'short' })
  })
  it('Ralph Lauren lines', () => {
    for (const l of ['Polo Ralph Lauren', 'Lauren Ralph Lauren', 'Ralph Lauren Collection', 'Ralph Lauren Purple Label', 'Double RL Ralph Lauren']) {
      expect(houseForLine(l, houses)?.house, l).toBe('Ralph Lauren')
    }
  })
  it('the house itself is not a line (caller handles exact matches)', () => {
    expect(houseForLine('Isabel Marant', houses)).toBeNull()
    expect(houseForLine('isabel  marant', houses)).toBeNull()
  })
  it('never inherits across unrelated names', () => {
    expect(houseForLine('Ralph & Russo', houses)).toBeNull()
    expect(houseForLine('Lauren Manoogian', houses)).toBeNull()
    expect(houseForLine('Rowen Rose', houses)).toBeNull()
    expect(houseForLine('Rag & Bone', houses)).toBeNull()
    expect(houseForLine('Row', houses)).toBeNull() // "The Row" has no short form — "the" is an article
  })
  it('a city on the end is an address, not a different house', () => {
    expect(houseForLine('DA LUNA', ['Da Luna London'])).toEqual({ house: 'Da Luna London', via: 'same' })
    expect(houseForLine('Anonymous', ['Anonymous Copenhagen'])).toEqual({ house: 'Anonymous Copenhagen', via: 'same' })
    expect(houseForLine('WYSE', ['WYSE London'])).toEqual({ house: 'WYSE London', via: 'same' })
    expect(houseForLine('COS', ['COS London'])).toBeNull() // three letters: too loose to call the same house
  })
  it('accents and & are normalised like brandKey', () => {
    expect(houseForLine('Ba & Sh Paris', houses)?.house).toBe('Ba&sh')
    expect(houseForLine('Sessun', houses)).toBeNull() // exact after normalisation → house, not line
  })
})
