/**
 * WHICH RULES A LOOK IS HELD TO — by layer.
 *
 *   global       every client, every style: no fuchsia, no clashing colours,
 *                no activewear. (White with cream is global too, but it is
 *                judged from the real colour in lib/pale-tone, not here.)
 *   house style  the client's assigned house style (a persona). Its
 *                constitution is written as sentences; a rule applies when its
 *                sentence is still in that constitution, so editing the style
 *                at /admin/stylists changes what is enforced.
 *   Chloe style  the House Style Constitution in lib/house-style — statement
 *                piece included. Applies only to a client with no other house
 *                style.
 *
 * Violations block a look; penalties lower its score. Pure: no I/O.
 */

import { CONSTITUTION_RULES, evaluateHouseStyle, type HouseItem, type EvaluateOpts, type RuleHit } from './house-style'

// layer.same_shape and set.coord_mismatch are about whether pieces make one
// outfit at all, not taste — Chloe: "learn this for future outfits, not just
// Alison". A sleeveless waistcoat over a sleeveless maxi dress; a co-ord shirt
// under a different pair of trousers.
export const GLOBAL_RULE_CODES = new Set([
  'colour.fuchsia', 'colour.discordant', 'category.activewear', 'layer.same_shape', 'set.coord_mismatch',
])

/** Global rules that BLOCK even though the house constitution only penalises them. */
const GLOBAL_BLOCKING = new Set(['colour.discordant'])

/**
 * Preferences, not bans. Chloe: "the statement piece is more of a preference for
 * Chloe style than a hard rule like the fuchsia colour or colours not matching or
 * items not going together". These lower a look's score instead of blocking it.
 */
export const SOFT_RULES: Record<string, number> = {
  'statement.none': 0.15,
  'statement.multiple': 0.15,
}

/** Judged elsewhere (lib/pale-tone), so never double-counted here. */
const HANDLED_ELSEWHERE = new Set(['colour.white_cream'])

/**
 * The constitution sentence each rule code enforces. A house style enforces a
 * code only if one of its article sentences matches.
 */
export const RULE_SENTENCES: Record<string, RegExp> = {
  'category.activewear': /gymwear|activewear/i,
  'category.print': /leopard|polka/i,
  'colour.fuchsia': /fuchsia/i,
  'colour.rainbow': /rainbow|more than 3 non-neutral/i,
  'colour.exploratory': /more than 3 non-neutral|never a rainbow/i,
  'colour.complementary_balanced': /complementary/i,
  'colour.discordant': /colour wheel|tonal and analogous/i,
  'colour.learned_skip': /colour wheel/i,
  'statement.multiple': /exactly one statement|one statement element/i,
  // Not "never bland": that is SCandi-Mum's core principle too, and matching it
  // brought Chloe's statement-piece rule back into a style that removed it.
  'statement.none': /exactly one statement|one statement element/i,
  'texture.budget': /textured or patterned|never 3/i,
  'echo.none': /echo/i,
  'silhouette.loose_on_loose': /loose.on.loose/i,
  'material.rejected': /rejected:/i,
  'material.formality_gap': /formality/i,
  'jewellery.loud_on_busy': /busy outfit|never both loud/i,
  'price.spread': /under £?150|over £?1,?000/i,
  'price.tier_skip': /adjacent tiers|skip a tier/i,
  'occasion.literal_whites': /literal whites/i,
  'occasion.no_layer': /lightweight jacket/i,
  'occasion.not_cute': /date night/i,
}

export interface StyleConstitution {
  articles?: { title?: string; rules?: string[] }[]
}

export interface MemberRules {
  /** Where the non-global rules came from, for notes and the UI. */
  source: 'house_style' | 'chloe_style' | 'global_only'
  styleName: string | null
  codes: Set<string>
}

/**
 * The rule codes a client is held to.
 * @param houseStyle her assigned house style, if any (name + constitution)
 * @param chloeStyle whether she is a Chloe-style client when she has no house style
 */
export function rulesForMember(
  houseStyle: { name: string | null; constitution: StyleConstitution | null } | null,
  chloeStyle: boolean,
): MemberRules {
  const codes = new Set(GLOBAL_RULE_CODES)
  const sentences = (houseStyle?.constitution?.articles ?? []).flatMap((a) => a.rules ?? [])
  if (houseStyle && sentences.length) {
    for (const [code, re] of Object.entries(RULE_SENTENCES)) {
      if (sentences.some((s) => re.test(s))) codes.add(code)
    }
    return { source: 'house_style', styleName: houseStyle.name, codes }
  }
  if (chloeStyle) {
    for (const r of CONSTITUTION_RULES) codes.add(r.code)
    return { source: 'chloe_style', styleName: 'Chloe', codes }
  }
  return { source: 'global_only', styleName: null, codes }
}

export interface LookJudgement {
  blocked: boolean
  /** Summed penalty weights for enforced penalty rules. */
  penalty: number
  violations: RuleHit[]
  penalties: RuleHit[]
}

export function judgeLook(items: HouseItem[], rules: MemberRules, opts: EvaluateOpts = {}): LookJudgement {
  const v = evaluateHouseStyle(items, opts)
  const on = (code: string) => rules.codes.has(code) && !HANDLED_ELSEWHERE.has(code)
  const violations: RuleHit[] = []
  const penalties: RuleHit[] = []
  for (const h of v.violations) {
    if (!on(h.code)) continue
    if (h.code in SOFT_RULES) penalties.push({ ...h, weight: SOFT_RULES[h.code] } as RuleHit)
    else violations.push(h)
  }
  for (const h of v.penalties) {
    if (!on(h.code)) continue
    if (GLOBAL_BLOCKING.has(h.code)) violations.push(h)
    else penalties.push(h)
  }
  return {
    blocked: violations.length > 0,
    penalty: penalties.reduce((sum, h) => sum + ((h as any).weight ?? 0), 0),
    violations,
    penalties,
  }
}
