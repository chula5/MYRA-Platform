import { describe, it, expect } from 'vitest'
import { readEventBrief, describeBrief } from '@/lib/events/brief'

describe('readEventBrief', () => {
  it('reads a long cocktail dress for New Year’s Eve', () => {
    const b = readEventBrief('new Years eve', 'a cocktail dress, so probably long')
    expect(b.itemTypes[0]).toBe('maxi_dress')
    expect(b.length).toBe('long')
    expect(b.dressy).toBe(true)
    expect(b.defaulted).toBe(false)
  })

  it('reads a short one as a mini dress, not shorts', () => {
    const b = readEventBrief('party dress', "let's try find a short one")
    expect(b.itemTypes).toEqual(['mini_dress'])
    expect(b.length).toBe('short')
    expect(b.dressy).toBe(true)
  })

  it('falls back to the event name when there is no brief', () => {
    const b = readEventBrief('party dress', null)
    expect(b.defaulted).toBe(false) // "dress" is in the name
    expect(b.itemTypes).toContain('midi_dress')
    expect(b.itemTypes).toContain('mini_dress')
  })

  it('keeps a named colour and material', () => {
    const b = readEventBrief('wedding', 'a black satin midi')
    expect(b.colours).toEqual(['black'])
    expect(b.materials).toContain('satin')
    expect(b.itemTypes[0]).toBe('midi_dress')
  })

  it('reads a non-dress garment when she names one', () => {
    const b = readEventBrief('client dinner', 'a sharp blazer')
    expect(b.itemTypes).toEqual(['blazer'])
  })

  it('defaults an unnamed occasion to something it can pick', () => {
    const b = readEventBrief('Greece holiday', '')
    expect(b.defaulted).toBe(true)
    expect(b.itemTypes.length).toBeGreaterThan(0)
  })

  it('says the brief back in one line', () => {
    expect(describeBrief(readEventBrief('new Years eve', 'a cocktail dress, probably long, in black'))).toBe('a long dressed-up dress, in black')
  })
})
