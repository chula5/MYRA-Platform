import { describe, it, expect } from 'vitest'
import { normaliseTileBoxes, coversImage } from '../tile-boxes'

describe('normaliseTileBoxes', () => {
  it('scales boxes back up to the original screenshot', () => {
    // Model saw a half-size image; original is 2000×1000.
    const [b] = normaliseTileBoxes([{ x: 100, y: 50, width: 200, height: 400 }], 2, 2000, 1000)
    expect(b.x).toBeLessThanOrEqual(200)
    expect(b.y).toBeLessThanOrEqual(100)
    expect(b.width).toBeGreaterThanOrEqual(400)
    expect(b.height).toBeGreaterThanOrEqual(800)
  })

  it('never crops outside the image', () => {
    const [b] = normaliseTileBoxes([{ x: -20, y: -20, width: 1100, height: 700 }], 1, 1000, 600)
    expect(b.x).toBe(0)
    expect(b.y).toBe(0)
    expect(b.x + b.width).toBeLessThanOrEqual(1000)
    expect(b.y + b.height).toBeLessThanOrEqual(600)
  })

  it('drops slivers — an avatar or a cut-off edge is not an outfit', () => {
    expect(normaliseTileBoxes([{ x: 10, y: 10, width: 40, height: 40 }], 1, 1200, 1600)).toEqual([])
  })

  it('keeps one of two boxes around the same photo', () => {
    const boxes = normaliseTileBoxes([
      { x: 100, y: 100, width: 300, height: 450 },
      { x: 110, y: 105, width: 295, height: 440 },
    ], 1, 1200, 1600)
    expect(boxes).toHaveLength(1)
  })

  it('returns a Pinterest-style grid in reading order', () => {
    const boxes = normaliseTileBoxes([
      { x: 620, y: 20, width: 280, height: 420 },
      { x: 20, y: 480, width: 280, height: 420 },
      { x: 20, y: 20, width: 280, height: 420 },
      { x: 320, y: 25, width: 280, height: 420 },
    ], 1, 920, 920)
    expect(boxes.map((b) => [b.x < 310 ? 'L' : b.x < 610 ? 'M' : 'R', b.y < 400 ? 'top' : 'bottom'].join('-')))
      .toEqual(['L-top', 'M-top', 'R-top', 'L-bottom'])
  })

  it('ignores a malformed box rather than failing the whole screenshot', () => {
    const boxes = normaliseTileBoxes([
      { x: NaN, y: 0, width: 100, height: 100 },
      { x: 20, y: 20, width: 300, height: 450 },
    ], 1, 1000, 1000)
    expect(boxes).toHaveLength(1)
  })
})

describe('coversImage', () => {
  it('knows a single photo from a tile in a board', () => {
    expect(coversImage({ x: 0, y: 0, width: 980, height: 990 }, 1000, 1000)).toBe(true)
    expect(coversImage({ x: 0, y: 0, width: 300, height: 450 }, 1000, 1000)).toBe(false)
  })
})
