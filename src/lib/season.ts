// SEASON — which half of the year a piece belongs to.
//
// Brand Watch queues what the shop is selling now, which in September is half
// a summer catalogue on its way out. Chloe won't take summer into the library
// as autumn starts, so each queued piece carries a season and the queue leads
// with the one we are heading into.
//
// Read, in order: the shop's own season codes and words (AW26, SS25,
// automne-hiver, résort…) in its tags, type and title; then the kind of piece
// (shorts and sandals are summer, coats and knitwear are winter); then the
// material (linen and raffia against wool and shearling). A piece that says
// nothing is left null and treated as in season — better shown than hidden.

export type Season = 'aw' | 'ss' | 'all'

/** August to January is autumn/winter; February to July is spring/summer. */
export function currentSeason(now: Date = new Date()): 'aw' | 'ss' {
  const m = now.getUTCMonth() + 1
  return m >= 8 || m <= 1 ? 'aw' : 'ss'
}

const AW_CODE = /(?:^|[^a-z0-9])(aw|fw|ah|ai|hw)[\s_-]?(\d{4}|\d{2})(?![0-9])/gi
const SS_CODE = /(?:^|[^a-z0-9])(ss|pe|sp|hs|pv)[\s_-]?(\d{4}|\d{2})(?![0-9])/gi
const AW_WORDS = /\b(autumn|automne|fall|winter|hiver|inverno|invierno|herbst|pre-?fall|holiday|noel|noël|christmas|xmas)\b/i
const SS_WORDS = /\b(spring|printemps|summer|été|ete|estate|verano|sommer|resort|cruise|swim|swimwear|beach|high\s?summer|vacances)\b/i

const SS_TYPES = new Set(['shorts', 'sandal', 'swimsuit', 'bikini', 'swimwear', 'espadrille', 'flip_flop', 'sarong', 'kaftan'])
const AW_TYPES = new Set(['coat', 'knitwear', 'gilet', 'boot', 'scarf', 'gloves', 'cape', 'poncho', 'jumper', 'cardigan', 'puffer', 'parka', 'shearling', 'beanie'])
const SS_MATERIALS = /\b(linen|lin|voile|seersucker|raffia|raphia|crochet|broderie anglaise|eyelet|gauze|terry|towelling)\b/i
const AW_MATERIALS = /\b(wool|laine|cashmere|cachemire|shearling|mouton|fur|fourrure|tweed|velvet|velours|corduroy|mohair|alpaca|alpaga|fleece|flannel|flanelle|bouclé|boucle|quilted|down|duvet)\b/i

export interface SeasonInput {
  tags?: string[] | null
  title?: string | null
  productType?: string | null
  itemType?: string | null
  materialCategory?: string | null
  materialPrimary?: string | null
}

export interface SeasonRead {
  season: Season | null
  /** The shop's own code when it gave one — "AW26". */
  code: string | null
  /** Where the answer came from, for the admin page. */
  basis: 'code' | 'words' | 'type' | 'material' | null
}

const year = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y))

/** The season of one piece, from what the shop says and what the piece is. */
export function seasonOf(p: SeasonInput): SeasonRead {
  const hay = [...(p.tags ?? []), p.productType ?? '', p.title ?? ''].join(' | ')

  // 1. Season codes. Both families present: the later year wins; a tie is a
  //    carry-over sold in both, so 'all'.
  const aw = Array.from(hay.matchAll(AW_CODE)).map((m) => ({ code: `${m[1].toUpperCase()}${m[2].slice(-2)}`, y: year(m[2]) }))
  const ss = Array.from(hay.matchAll(SS_CODE)).map((m) => ({ code: `${m[1].toUpperCase()}${m[2].slice(-2)}`, y: year(m[2]) }))
  const latest = (xs: { code: string; y: number }[]) => xs.reduce<{ code: string; y: number } | null>((a, b) => (!a || b.y > a.y ? b : a), null)
  const la = latest(aw), ls = latest(ss)
  if (la && ls) {
    if (la.y > ls.y) return { season: 'aw', code: la.code, basis: 'code' }
    if (ls.y > la.y) return { season: 'ss', code: ls.code, basis: 'code' }
    return { season: 'all', code: la.code, basis: 'code' }
  }
  if (la) return { season: 'aw', code: la.code, basis: 'code' }
  if (ls) return { season: 'ss', code: ls.code, basis: 'code' }

  // 2. Season words in the tags or type (not the title alone — "Winter" is a
  //    colour name at some shops, and "Riviera" is a style name).
  const tagHay = [...(p.tags ?? []), p.productType ?? ''].join(' | ')
  const awW = AW_WORDS.test(tagHay), ssW = SS_WORDS.test(tagHay)
  if (awW && !ssW) return { season: 'aw', code: null, basis: 'words' }
  if (ssW && !awW) return { season: 'ss', code: null, basis: 'words' }

  // 3. The kind of piece.
  const t = (p.itemType ?? '').toLowerCase()
  if (SS_TYPES.has(t)) return { season: 'ss', code: null, basis: 'type' }
  if (AW_TYPES.has(t)) return { season: 'aw', code: null, basis: 'type' }

  // 4. The material.
  const mat = `${p.materialPrimary ?? ''} ${p.materialCategory ?? ''} ${p.title ?? ''}`
  if (AW_MATERIALS.test(mat)) return { season: 'aw', code: null, basis: 'material' }
  if (SS_MATERIALS.test(mat)) return { season: 'ss', code: null, basis: 'material' }

  return { season: null, code: null, basis: null }
}

/** Whether a piece belongs in the season we are heading into. Unknown counts as yes. */
export function inSeason(season: Season | null | undefined, now: Date = new Date()): boolean {
  if (!season || season === 'all') return true
  return season === currentSeason(now)
}
