// Fitting a brand scatter to the brands actually being shown.
//
// A member's world occupies a small corner of the full brand ladder — Alison's
// brands top out around £500 against a ladder that runs past £3,000 — so
// reusing the global scale leaves two-thirds of the chart empty and squashes
// every dot she cares about into a band. This frames the plot on the points
// given, with breathing room and a floor on the span so a tight cluster does
// not blow up into a meaningless zoom.

export interface FramePoint { x: number; y: number } // y is ln(price)

export interface Margins { left: number; right: number; top: number; bottom: number }

export interface Frame {
  sx: (v: number) => number
  sy: (v: number) => number
  grid: number[] // round £ values that fall inside the framed range
  lo: number // £ at the bottom of the frame
  hi: number // £ at the top
}

const PRICE_LADDER = [50, 80, 100, 150, 200, 300, 400, 600, 800, 1200, 1500, 2000, 3000, 5000]

// Minimum vertical span, as a price ratio: without it, brands all sitting at
// ~£200 would zoom until noise looked like structure.
export const MIN_PRICE_SPAN = 1.35

export function fitFrame(points: FramePoint[], W: number, H: number, M: Margins): Frame | null {
  if (!points.length) return null
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  let x0 = Math.min(...xs), x1 = Math.max(...xs)
  let y0 = Math.min(...ys), y1 = Math.max(...ys)

  const xPad = Math.max((x1 - x0) * 0.12, 0.04)
  const yPad = Math.max((y1 - y0) * 0.16, Math.log(MIN_PRICE_SPAN))
  x0 -= xPad; x1 += xPad; y0 -= yPad; y1 += yPad

  const xSpan = x1 - x0 || 1
  const ySpan = y1 - y0 || 1
  return {
    sx: (v: number) => M.left + ((v - x0) / xSpan) * (W - M.left - M.right),
    // price rises up the chart
    sy: (v: number) => H - M.bottom - ((v - y0) / ySpan) * (H - M.top - M.bottom),
    grid: PRICE_LADDER.filter((p) => Math.log(p) > y0 && Math.log(p) < y1),
    lo: Math.exp(y0),
    hi: Math.exp(y1),
  }
}
