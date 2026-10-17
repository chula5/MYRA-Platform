// EVENT PICKS — the pieces MYRA finds for what she has coming up.
//
// For each upcoming known event (0029 + the brief on it, 0099) MYRA picks a
// few hero pieces that answer the brief — from the brands she named first,
// then the brands her affinities put next to them — in her size and her price
// band, and styles each one for the occasion through the same WAYS TO WEAR
// composer every other surface uses (three outfits, every one through MYRA's
// eye before it is kept). A piece is only a pick when at least one outfit
// around it passed. Picks are kept on event_pick; the outfits live where ways
// always live (styled_way, source 'event'), so the Events room opens them in
// the same sheet as a tap on any piece.
//
// Weekly: the Monday cron (/api/cron/event-picks) adds a week's new picks
// after the Brand Watch upload and tells her. Nothing here sends anything.

import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import { loadComposableLibrary, loadMemberTaste } from '@/app/admin/private-stylist/actions'
import { itemPriceVerdict, memberItemScore, type MemberTaste } from '@/lib/pilot-composer'
import { avoidReasons, readStylePrefs } from '@/lib/pilot-stylist'
import { sellable } from '@/lib/stock-sellable'
import { isOwnedItem } from '@/lib/wardrobe/owned-items'
import { composeStyledWays } from '@/lib/styled-ways-compose'
import { getStyledWays } from '@/lib/styled-ways'
import type { StyledWayLook } from '@/lib/styled-ways-core'
import type { ItemWithBrand } from '@/lib/admin-queries'
import { readEventBrief, describeBrief, sayPlace, MONTH_NAMES, type EventBrief } from './brief'

export const EVENT_PICKS_MIGRATION_HINT = 'Run migration 0099_event_picks.sql first (npm run migrate)'
const missing = (m: string) => /event_pick|schema cache|does not exist|column .*brief/i.test(m)

/** Options per event per week — three (Chloe, 2026-10-15; it was two). */
export const PICKS_PER_EVENT = 3
/** How many heroes may be tried to land the picks — a hero whose outfits all fail is skipped, not shown. */
const TRIES_PER_PICK = 3
/** The occasions an event hero is styled for. */
const EVENT_OCCASIONS = ['event', 'dinner_drinks']
/** How far ahead an event counts as coming up. */
const HORIZON_DAYS = 180

export interface KnownEventRow { event_id: string; member_id: string; label: string; event_date: string; brief: string | null; done: boolean }

export interface EventPickView {
  event_pick_id: string
  item_id: string
  product_name: string
  brand: string | null
  price_gbp: number | null
  image_url: string | null
  url: string | null
  why: string
  week_key: string
  shown: boolean
  told_at: string | null
  picked_at: string
  /** The outfits kept around it, best first (what the WAYS sheet opens on). */
  ways: StyledWayLook[]
}

export interface EventWithPicks {
  event_id: string
  label: string
  event_date: string
  brief: string | null
  /** The brief as MYRA read it, in one line. */
  reading: string
  picks: EventPickView[]
}

/** "2026-W42" — the week a pick belongs to (ISO, Monday first). */
export function weekKey(d = new Date()): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const day = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

/**
 * Is the event still ahead? Dates may be a month ("2026-12") or a day; a month
 * counts until it is over, a day until the day after.
 */
export function eventUpcoming(eventDate: string, now = new Date(), horizonDays = HORIZON_DAYS): boolean {
  const [y, m, d] = (eventDate ?? '').split('-').map(Number)
  if (!y || !m) return false
  const end = d ? new Date(Date.UTC(y, m - 1, d + 1)) : new Date(Date.UTC(y, m, 1))
  const start = d ? new Date(Date.UTC(y, m - 1, d)) : new Date(Date.UTC(y, m - 1, 1))
  const horizon = new Date(now.getTime() + horizonDays * 86_400_000)
  return end.getTime() > now.getTime() && start.getTime() <= horizon.getTime()
}

/** Her upcoming known events, soonest first. */
export async function upcomingEvents(admin: any, memberId: string): Promise<KnownEventRow[]> {
  const { data, error } = await admin.from('pilot_known_event')
    .select('event_id, member_id, label, event_date, brief, done')
    .eq('member_id', memberId).eq('done', false).order('event_date')
  if (error) throw new Error(missing(error.message) ? EVENT_PICKS_MIGRATION_HINT : error.message)
  return ((data ?? []) as KnownEventRow[]).filter((e) => eventUpcoming(e.event_date))
}

/** The brief for an event: the event's own, else the brief of a task set for it. */
async function briefFor(admin: any, event: KnownEventRow): Promise<string | null> {
  if (event.brief?.trim()) return event.brief.trim()
  const { data } = await admin.from('member_styling_task').select('brief')
    .eq('known_event_id', event.event_id).eq('member_id', event.member_id).order('created_at', { ascending: false }).limit(1).maybeSingle()
  return data?.brief?.trim() || null
}

// ── Choosing the heroes ──────────────────────────────────────────────────────

const priceOf = (it: any): number | null => {
  const p = it.price_gbp ?? (it.currency === 'GBP' || !it.currency ? it.price : null)
  const n = p == null ? NaN : Number(p)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** A product family key: the same dress in another colour is one option, not two. */
const familyKey = (it: any): string => {
  const name = String(it.product_name ?? '').toLowerCase()
    .replace(/\b(black|white|ivory|cream|navy|red|green|blue|pink|brown|choc|chocolate|camel|grey|gray|olive|burgundy|bordeaux|off white|milk|steel)\b/g, '')
    .replace(/[^a-z]+/g, ' ').trim()
  return `${it.brand_id ?? ''}|${name}`
}

export interface HeroCandidate { item: ItemWithBrand; score: number; reasons: string[] }

/**
 * Rank the library for one event. Hard gates: a sellable retail piece with a
 * picture, of a type the brief asks for, not over her price band, not a brand
 * she only named as input, nothing she has said she avoids. Then the pull:
 * her brand affinity above all (the brands she named sit at 1.0, their
 * neighbours lower), the brief's own order of types, a colour or material she
 * named, how dressed the piece reads for a dressed-up night, and her taste.
 */
export function rankHeroes(
  taste: MemberTaste,
  library: ItemWithBrand[],
  brief: EventBrief,
  opts: { exclude?: Set<string>; excludeFamilies?: Set<string> } = {},
): HeroCandidate[] {
  const types = brief.itemTypes
  const prefs = taste.prefs
  const out: HeroCandidate[] = []
  const seenFamily = new Set<string>(opts.excludeFamilies ?? [])
  for (const it of library) {
    const i = it as any
    if (!i.image_url || !i.item_type || !types.includes(i.item_type)) continue
    if (isOwnedItem(i) || !sellable(i)) continue
    if (opts.exclude?.has(i.item_id)) continue
    if (i.brand?.name && taste.inputOnlyBrands.has(String(i.brand.name).toLowerCase())) continue
    if (i.brand_id && taste.hiddenBrandIds?.has(i.brand_id)) continue
    if (prefs && avoidReasons(prefs, i).length) continue
    if (itemPriceVerdict(taste, it) === 'over') continue
    if (priceOf(i) == null) continue
    const fam = familyKey(i)
    if (seenFamily.has(fam)) continue

    const reasons: string[] = []
    const affinity = i.brand_id ? (taste.affinity.get(i.brand_id) ?? 0) : 0
    let score = affinity * 2
    if (affinity >= 0.95) reasons.push('one of her brands')
    else if (affinity >= 0.3) reasons.push('a brand near hers')
    const typeRank = types.indexOf(i.item_type)
    score += Math.max(0, 0.6 - typeRank * 0.2)
    if (brief.colours.length) {
      if (brief.colours.includes(i.colour_family)) { score += 0.8; reasons.push(`in ${i.colour_family}`) }
      else score -= 0.6
    }
    if (brief.materials.length) {
      const mat = String(i.material_primary ?? i.product_name ?? '').toLowerCase()
      if (brief.materials.some((m) => mat.includes(m))) { score += 0.5; reasons.push(brief.materials.join('/')) }
    }
    if (brief.dressy) {
      const f = Number(i.material_formality ?? 0)
      if (f >= 4) { score += 0.3; reasons.push('reads dressed') }
      else if (f > 0 && f <= 2) score -= 0.4
      if (i.sheen === 'high' || /satin|silk|lace|organza|velvet|sequin|beaded/i.test(String(i.product_name ?? ''))) score += 0.2
    }
    if (brief.climate) {
      // Edinburgh in December wants sleeves and weight; Ibiza in July wants
      // none of that. Read from the name, the cloth and the type.
      const text = `${i.product_name ?? ''} ${i.material_primary ?? ''} ${String(i.item_type ?? '').replace(/_/g, ' ')}`.toLowerCase()
      const warm = /\b(wool|cashmere|merino|knit|knitted|knitwear|tweed|velvet|boucl[eé]|shearling|leather|corduroy|flannel|long[- ]sleeve|roll[- ]neck|turtleneck|coat|jumper|sweater|cardigan|quilted|puffer|boot)\b/.test(text)
      const light = /\b(linen|cotton voile|chiffon|organza|crochet|slip|cami|camisole|strappy|strapless|halter|sleeveless|bandeau|cut[- ]out|sarong|kaftan|swim|bikini|sandal|short sleeve|shorts)\b/.test(text)
      const cold = brief.climate === 'cold' || brief.climate === 'cool'
      const hot = brief.climate === 'hot' || brief.climate === 'warm'
      if (cold && warm) { score += brief.climate === 'cold' ? 0.5 : 0.3; reasons.push('made for the cold') }
      if (cold && light) score -= brief.climate === 'cold' ? 0.8 : 0.4
      if (hot && light) { score += brief.climate === 'hot' ? 0.5 : 0.3; reasons.push('made for the heat') }
      if (hot && warm) score -= brief.climate === 'hot' ? 0.8 : 0.4
    }
    score += 0.3 * memberItemScore(taste, it)
    seenFamily.add(fam)
    out.push({ item: it, score, reasons })
  }
  return out.sort((a, b) => b.score - a.score)
}

const TYPE_WORD: Record<string, string> = {
  mini_dress: 'mini dress', midi_dress: 'midi dress', maxi_dress: 'maxi dress', slip_dress: 'slip dress', shirt_dress: 'shirt dress',
}
const MATERIAL_WORD = /\b(satin|silk|lace|organza|velvet|sequin|sequinned|beaded|linen|cotton|knit|denim|jacquard|cupro|crepe|tulle|chiffon)\b/i

/** One line on why this piece, for the note and the card: the piece as it is, not the brief repeated. */
function whyPick(c: HeroCandidate, brief: EventBrief, label: string): string {
  const it = c.item as any
  const brand = it.brand?.name ?? ''
  const colour = it.colour_family && it.colour_family !== 'multicolour' ? String(it.colour_family) : ''
  // The name's own word first ("silk organza"), the tagged material after: the tag is the body, the name is the piece.
  const material = (String(it.product_name ?? '').match(MATERIAL_WORD) ?? String(it.material_primary ?? '').match(MATERIAL_WORD))?.[1]?.toLowerCase() ?? ''
  const type = TYPE_WORD[it.item_type] ?? String(it.item_type ?? 'piece').replace(/_/g, ' ')
  const what = [colour, material, type].filter(Boolean).join(' ')
  const article = /^[aeiou]/i.test(what) ? 'an' : 'a'
  const lead = c.reasons.includes('one of her brands')
    ? `From ${brand}, one of your brands`
    : c.reasons.includes('a brand near hers') ? `${brand}, close to the brands you love` : brand
  const fit = brief.dressy && Number(it.material_formality ?? 0) >= 4 ? ', dressed enough for the night' : ''
  // "for Edinburgh in December, with the cold in mind" when the event is a place MYRA knows.
  const where = brief.place
    ? `${sayPlace(brief.place)}${brief.month ? ` in ${MONTH_NAMES[brief.month - 1]}` : ''}${brief.climate === 'cold' || brief.climate === 'cool' ? ', with the cold in mind' : brief.climate === 'hot' || brief.climate === 'warm' ? ', with the heat in mind' : ''}`
    : label.trim()
  return `${lead} — ${article} ${what}${fit}, for ${where}.`
}

// ── Composing picks ──────────────────────────────────────────────────────────

export interface ComposePicksOpts {
  /** Only these events (else every upcoming one). */
  eventIds?: string[]
  /** New picks wanted per event this run. */
  perEvent?: number
  /** Hold the picks from her (a trial for Chloe to look at first). */
  hold?: boolean
  /** Add picks even when this week already has them. */
  force?: boolean
  admin?: any
}

export interface ComposedEventReport {
  event_id: string
  label: string
  brief: string | null
  reading: string
  candidates: number
  tried: string[]
  picked: { item_id: string; name: string; brand: string | null; price: number | null; ways: number; why: string }[]
  skipped?: string
}

export interface ComposePicksResult { week: string; events: ComposedEventReport[]; error?: string }

/**
 * Make this week's picks for one member. Idempotent per week: an event that
 * already has its picks this week is left alone unless `force`.
 */
export async function composeEventPicks(memberId: string, opts: ComposePicksOpts = {}): Promise<ComposePicksResult> {
  const admin = opts.admin ?? (createAdminClient() as any)
  const perEvent = Math.max(1, Math.min(4, opts.perEvent ?? PICKS_PER_EVENT))
  const week = weekKey()
  const { data: member } = await admin.from('pilot_member').select('*').eq('member_id', memberId).maybeSingle()
  if (!member) return { week, events: [], error: 'Member not found' }

  let events: KnownEventRow[]
  try { events = await upcomingEvents(admin, memberId) } catch (err) { return { week, events: [], error: err instanceof Error ? err.message : String(err) } }
  if (opts.eventIds?.length) events = events.filter((e) => opts.eventIds!.includes(e.event_id))
  if (!events.length) return { week, events: [] }

  const [library, taste] = await Promise.all([loadComposableLibrary(member), loadMemberTaste(admin, member)])
  if (!taste.prefs) taste.prefs = readStylePrefs(member)
  const reports: ComposedEventReport[] = []

  // Every pick she has ever had, for any event: the same dress is never the
  // option for Florence AND for Edinburgh (Chloe, 2026-10-15). Picks made
  // earlier in this run count too.
  const { data: allPrior, error: allErr } = await admin.from('event_pick').select('item_id, known_event_id, week_key, dismissed_at').eq('member_id', memberId)
  if (allErr) return { week, events: [], error: missing(allErr.message) ? EVENT_PICKS_MIGRATION_HINT : allErr.message }
  const allRows = (allPrior ?? []) as { item_id: string; known_event_id: string; week_key: string; dismissed_at: string | null }[]
  const usedItems = new Set(allRows.map((p) => p.item_id))
  const usedFamilies = new Set(library.filter((i) => usedItems.has(i.item_id)).map((i) => familyKey(i)))

  for (const event of events) {
    const briefText = await briefFor(admin, event)
    const brief = readEventBrief(event.label, briefText, event.event_date)
    const report: ComposedEventReport = { event_id: event.event_id, label: event.label, brief: briefText, reading: describeBrief(brief), candidates: 0, tried: [], picked: [] }
    reports.push(report)

    const priorRows = allRows.filter((p) => p.known_event_id === event.event_id)
    if (!opts.force && priorRows.some((p) => p.week_key === week && !p.dismissed_at)) { report.skipped = 'already has picks this week'; continue }

    const ranked = rankHeroes(taste, library, brief, { exclude: usedItems, excludeFamilies: usedFamilies })
    report.candidates = ranked.length

    // Breadth: the first pass takes at most one piece per brand, per colour
    // (when she named no colour) AND per type (when the brief allows more
    // than one), so three options are three brands, three colours and — for
    // a trip — a dress, a knit and a coat rather than three ivory minis.
    const usedBrands = new Set<string>()
    const usedColours = new Set<string>()
    const usedTypes = new Set<string>()
    const queue: HeroCandidate[] = []
    for (const c of ranked) {
      const b = (c.item as any).brand_id ?? ''
      const col = brief.colours.length ? '' : String((c.item as any).colour_family ?? '')
      const type = brief.itemTypes.length > 1 ? String((c.item as any).item_type ?? '') : ''
      if (usedBrands.has(b) || (col && usedColours.has(col)) || (type && usedTypes.has(type))) continue
      usedBrands.add(b); if (col) usedColours.add(col); if (type) usedTypes.add(type); queue.push(c)
    }
    for (const c of ranked) if (!queue.includes(c)) queue.push(c)

    let tries = 0
    const pickedColours = new Set<string>()
    for (const c of queue) {
      if (report.picked.length >= perEvent || tries >= perEvent * TRIES_PER_PICK) break
      // While there is still choice, do not pick a second piece in the same colour.
      const col = brief.colours.length ? '' : String((c.item as any).colour_family ?? '')
      if (col && pickedColours.has(col) && tries < perEvent * (TRIES_PER_PICK - 1)) continue
      tries++
      report.tried.push(`${(c.item as any).brand?.name ?? ''} ${c.item.product_name}`.trim())
      const existing = await getStyledWays(admin, memberId, c.item.item_id, 'blend')
      let ways = existing.length
      if (ways < 1) {
        const r = await composeStyledWays(memberId, c.item.item_id, { mode: 'blend', source: 'event', occasions: EVENT_OCCASIONS, admin })
        ways = r.saved.length
      }
      if (ways < 1) continue
      const why = whyPick(c, brief, event.label)
      const { error } = await admin.from('event_pick').upsert({
        member_id: memberId, known_event_id: event.event_id, item_id: c.item.item_id, why, week_key: week,
        shown: !opts.hold, picked_at: new Date().toISOString(),
      }, { onConflict: 'known_event_id,item_id' })
      if (error) { report.skipped = missing(error.message) ? EVENT_PICKS_MIGRATION_HINT : error.message; break }
      if (col) pickedColours.add(col)
      usedItems.add(c.item.item_id)
      usedFamilies.add(familyKey(c.item))
      report.picked.push({ item_id: c.item.item_id, name: c.item.product_name, brand: (c.item as any).brand?.name ?? null, price: priceOf(c.item), ways, why })
    }
  }
  return { week, events: reports }
}

// ── Reading picks ────────────────────────────────────────────────────────────

/**
 * Her upcoming events with their picks and the outfits kept around each.
 * `includeHeld` shows held picks too (Chloe's review); members see shown only.
 */
export async function eventsWithPicks(memberId: string, opts: { includeHeld?: boolean; admin?: any } = {}): Promise<EventWithPicks[]> {
  const admin = opts.admin ?? (createAdminClient() as any)
  const events = await upcomingEvents(admin, memberId)
  if (!events.length) return []
  let q = admin.from('event_pick').select('*').eq('member_id', memberId).in('known_event_id', events.map((e) => e.event_id)).is('dismissed_at', null).order('picked_at', { ascending: false })
  if (!opts.includeHeld) q = q.eq('shown', true)
  const { data: picks, error } = await q
  if (error) throw new Error(missing(error.message) ? EVENT_PICKS_MIGRATION_HINT : error.message)
  const rows = (picks ?? []) as any[]
  const itemIds = Array.from(new Set(rows.map((p) => p.item_id)))
  const { data: items } = itemIds.length
    ? await admin.from('item').select('item_id, product_name, image_url, price, price_gbp, currency, retailer_url, status, brand:brand_id(name)').in('item_id', itemIds)
    : { data: [] }
  const byId = new Map(((items ?? []) as any[]).map((i) => [i.item_id, i]))
  const ways = new Map<string, StyledWayLook[]>()
  await Promise.all(itemIds.map(async (id) => { ways.set(id, await getStyledWays(admin, memberId, id, 'blend')) }))

  const out: EventWithPicks[] = []
  for (const e of events) {
    const briefText = e.brief?.trim() || (await briefFor(admin, e))
    const reading = describeBrief(readEventBrief(e.label, briefText, e.event_date))
    const ps = rows.filter((p) => p.known_event_id === e.event_id).map((p): EventPickView | null => {
      const it = byId.get(p.item_id)
      if (!it || it.status === 'archived') return null
      return {
        event_pick_id: p.event_pick_id, item_id: p.item_id, product_name: it.product_name, brand: it.brand?.name ?? null,
        price_gbp: priceOf(it), image_url: it.image_url ?? null, url: it.retailer_url ?? null, why: p.why ?? '',
        week_key: p.week_key, shown: !!p.shown, told_at: p.told_at ?? null, picked_at: p.picked_at, ways: ways.get(p.item_id) ?? [],
      }
    }).filter((p): p is EventPickView => !!p)
    out.push({ event_id: e.event_id, label: e.label, event_date: e.event_date, brief: briefText, reading, picks: ps })
  }
  return out
}

/** She has been told about these picks. */
export async function markPicksTold(admin: any, pickIds: string[]): Promise<void> {
  if (!pickIds.length) return
  await admin.from('event_pick').update({ told_at: new Date().toISOString() }).in('event_pick_id', pickIds)
}

/** Chloe lets a held pick through (or takes one back). */
export async function setPickShown(admin: any, pickId: string, shown: boolean): Promise<{ error?: string }> {
  const { error } = await admin.from('event_pick').update({ shown }).eq('event_pick_id', pickId)
  return error ? { error: error.message } : {}
}

/** Not this one: the pick goes, and is never picked for this event again. */
export async function dismissPick(admin: any, memberId: string, pickId: string): Promise<{ error?: string }> {
  const { error } = await admin.from('event_pick').update({ dismissed_at: new Date().toISOString() }).eq('event_pick_id', pickId).eq('member_id', memberId)
  return error ? { error: error.message } : {}
}

/** What she is looking for, in her words, on the event itself. */
export async function setKnownEventBrief(admin: any, memberId: string, eventId: string, brief: string): Promise<{ error?: string }> {
  const clean = (brief ?? '').trim().slice(0, 300)
  const { error } = await admin.from('pilot_known_event')
    .update({ brief: clean || null, updated_at: new Date().toISOString() })
    .eq('event_id', eventId).eq('member_id', memberId)
  return error ? { error: missing(error.message) ? EVENT_PICKS_MIGRATION_HINT : error.message } : {}
}
