import { describe, it, expect } from 'vitest'
import { readEventBrief, describeBrief, readPlace, climateOf } from '@/lib/events/brief'

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


describe('a trip, read from its place and month', () => {
  it('knows Edinburgh in December is cold and leads with layers', () => {
    const b = readEventBrief('Edinburgh', null, '2026-12')
    expect(b.place).toBe('edinburgh')
    expect(b.climate).toBe('cold')
    expect(b.itemTypes[0]).toBe('knitwear')
    expect(b.itemTypes).toContain('coat')
    expect(describeBrief(b)).toContain('Edinburgh in December, cold')
  })

  it('reads Florence in November as cool and still offers a dress first', () => {
    const b = readEventBrief('Florence', null, '2026-11-14')
    expect(b.climate).toBe('cool')
    expect(b.itemTypes[0]).toBe('midi_dress')
    expect(b.itemTypes).toContain('knitwear')
  })

  it('reads a place inside a longer name, and leaves the brief in charge', () => {
    expect(readPlace('a wedding in Ibiza')).toBe('ibiza')
    const b = readEventBrief('a wedding in Ibiza', 'a long silk dress', '2027-06-20')
    expect(b.climate).toBe('warm')
    expect(b.itemTypes[0]).toBe('maxi_dress')
    expect(b.dressy).toBe(true)
  })

  it('has no climate for an event that is not a place', () => {
    const b = readEventBrief('new Years eve', 'a cocktail dress', '2026-12-31')
    expect(b.place).toBeNull()
    expect(b.climate).toBeNull()
    expect(climateOf(null, 12)).toBeNull()
  })
})
