import { describe, it, expect } from 'vitest'
import { fitFrame, MIN_PRICE_SPAN } from '@/lib/brand-map-frame'

const M = { left: 145, right: 24, top: 16, bottom: 44 }
const W = 1000, H = 520
const at = (x: number, price: number) => ({ x, y: Math.log(price) })

describe('fitFrame', () => {
  it('frames on the brands shown, not the whole ladder', () => {
    // Alison's real spread: £132 to £557
    const f = fitFrame([at(0.1, 132), at(0.5, 295), at(0.9, 557)], W, H, M)!
    expect(f.lo).toBeGreaterThan(90)
    expect(f.hi).toBeLessThan(850)
    // gridlines are the round prices inside the padded range — £100 falls in
    // it because the floor pads below her cheapest brand
    expect(f.grid).toEqual([100, 150, 200, 300, 400, 600])
    expect(f.grid).not.toContain(3000)
    expect(f.grid).not.toContain(1500)
  })

  it('uses the full plot height for that range', () => {
    const f = fitFrame([at(0, 132), at(1, 557)], W, H, M)!
    const top = f.sy(Math.log(557))
    const bottom = f.sy(Math.log(132))
    const plotH = H - M.top - M.bottom
    // the spread should occupy most of the plot, not a corner of it
    expect(bottom - top).toBeGreaterThan(plotH * 0.6)
    // and stay inside the margins
    expect(top).toBeGreaterThanOrEqual(M.top)
    expect(bottom).toBeLessThanOrEqual(H - M.bottom)
  })

  it('spans the full width horizontally', () => {
    const f = fitFrame([at(-2, 200), at(2, 200)], W, H, M)!
    expect(f.sx(-2)).toBeGreaterThan(M.left)
    expect(f.sx(2)).toBeLessThan(W - M.right)
    expect(f.sx(2) - f.sx(-2)).toBeGreaterThan((W - M.left - M.right) * 0.7)
  })

  it('refuses to over-zoom a tight cluster', () => {
    // every brand at almost exactly £200 — must not become a meaningless zoom
    const f = fitFrame([at(0.1, 199), at(0.2, 200), at(0.3, 201)], W, H, M)!
    expect(f.hi / f.lo).toBeGreaterThanOrEqual(MIN_PRICE_SPAN * MIN_PRICE_SPAN * 0.99)
  })

  it('handles a single brand and an empty set', () => {
    expect(fitFrame([], W, H, M)).toBe(null)
    const one = fitFrame([at(0.5, 300)], W, H, M)!
    expect(Number.isFinite(one.sx(0.5))).toBe(true)
    expect(Number.isFinite(one.sy(Math.log(300)))).toBe(true)
    expect(one.lo).toBeLessThan(300)
    expect(one.hi).toBeGreaterThan(300)
  })
})
