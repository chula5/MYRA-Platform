// Price phrases in a free-text brand search — "under £400", "around 250",
// "£200-300", "300+", "parisian under 400". Deterministic, no API cost.
// Whatever is not a price phrase comes back as `rest`, for name/style matching.

export interface PriceQuery {
  min?: number
  max?: number
  rest: string
}

const NUM = String.raw`£?\s*(\d[\d,]*(?:\.\d+)?)\s*(k)?`
const num = (n: string, k?: string) => Number(n.replace(/,/g, '')) * (k ? 1000 : 1)

// "around" means ±25% — wide enough to catch a brand whose median is £230
// when she says £250, narrow enough not to drift into the next band.
const AROUND = 0.25

export function parsePriceQuery(raw: string): PriceQuery {
  let text = ` ${String(raw ?? '').toLowerCase()} `
  const out: PriceQuery = { rest: '' }
  const take = (re: RegExp, fn: (m: RegExpMatchArray) => void) => {
    const m = text.match(re)
    if (!m) return false
    fn(m)
    text = text.replace(m[0], ' ')
    return true
  }

  // ranges first, so "between 200 and 300" isn't read as two separate prices
  take(new RegExp(String.raw`(?:between\s+)?${NUM}\s*(?:-|–|to|and)\s*${NUM}`), (m) => {
    const a = num(m[1], m[2]), b = num(m[3], m[4])
    out.min = Math.min(a, b); out.max = Math.max(a, b)
  })
  take(new RegExp(String.raw`(?:under|below|less than|up to|upto|max(?:imum)?|cheaper than|<=?)\s*${NUM}`), (m) => { out.max = num(m[1], m[2]) })
  take(new RegExp(String.raw`(?:over|above|more than|from|min(?:imum)?|at least|>=?)\s*${NUM}`), (m) => { out.min = num(m[1], m[2]) })
  take(new RegExp(String.raw`${NUM}\s*\+`), (m) => { out.min = num(m[1], m[2]) })
  take(new RegExp(String.raw`(?:around|about|approx(?:imately)?|roughly|circa|~)\s*${NUM}`), (m) => {
    const v = num(m[1], m[2]); out.min = Math.round(v * (1 - AROUND)); out.max = Math.round(v * (1 + AROUND))
  })
  // a bare "£250" (needs the £ so a brand like "3.1 Phillip Lim" isn't a price)
  if (out.min == null && out.max == null) {
    take(/£\s*(\d[\d,]*(?:\.\d+)?)\s*(k)?/, (m) => {
      const v = num(m[1], m[2]); out.min = Math.round(v * (1 - AROUND)); out.max = Math.round(v * (1 + AROUND))
    })
  }

  out.rest = text
    .replace(/\b(all|brands?|that|have|has|with|an?|the|average|avg|typical|item|items|price|priced|pieces?|of|for|her|add|pounds?|gbp|quid)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return out
}
