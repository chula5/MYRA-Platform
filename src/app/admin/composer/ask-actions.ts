// NOT a 'use server' module, on purpose (see ./actions.ts): the admin UI calls
// the admin-gated wrapper in ./ask-actions.gated.ts. Don't add 'use server' here.
//
// BUILD FROM WORDS — the Composer's and Outfit Review's natural-language bar.
// "A silk blue dress, brown Isabel Marant heels and a leather jacket" becomes
// looks made of exactly those pieces; "find a long dress to go with this"
// becomes looks of the anchor with a long dress. The sentence is read by
// lib/outfit-ask; this file puts the matches together, fills the slots a
// look still needs (shoes, a bottom), and scores and gates the results the
// way the Composer and Review do, so a look built from words approves,
// swaps and teaches exactly as any other.

import { createAdminClient } from '@/lib/supabase-server'
import { getItem, getReadyAndLiveItems, type ItemWithBrand } from '@/lib/admin-queries'
import { pairCompat, slotForItemType, deriveSlotScores, deriveOutfitLevelScores, type Slot } from '@/lib/composer'
import { parseOutfitAsk, rankForPiece, matchesPiece, slotOfPiece, type PieceSpec } from '@/lib/outfit-ask'
import { loadStyleModel, recordStyleOffers } from '@/lib/style-brain-store'
import { formalityBand, deriveOccasionScores, confidenceGate, hardSkipPairs, isExcluded } from '@/lib/pipeline'
import { evaluateHouseStyle } from '@/lib/house-style'
import { toHouseItem, loadLearnedMaterialPairs } from '@/lib/house-style-store'
import { loadEjectionConstraints, loadApprovedVectors, loadPipelineConfig, vectorForCandidate } from '@/lib/pipeline-store'
import { tierBandViolation, reviewFeature } from '@/lib/review-compose'
import { sellable } from '@/lib/stock-sellable'
import { priceOfItem } from '@/lib/brand-affinity'

const LOOKS = 6
const FILLERS_PER_SLOT = 3
const MAX_COMBOS = 4000
const MAX_USES_PER_PIECE = 2
// Which of her pieces anchors a look built from nothing: the garment the rest
// is worn around.
const ANCHOR_PRIORITY: Slot[] = ['dress', 'top', 'bottom', 'outerwear', 'shoe', 'bag', 'jewellery', 'accessory']

export interface AskPiece {
  item_id: string
  product_name: string
  brand_name: string | null
  image_url: string
  item_type: string
  colour_family: string | null
  price: string
  stock_status?: 'in_stock' | 'low_stock' | 'out_of_stock' | 'unknown' | null
  stock_sizes?: string[] | null
}

export interface AskCandidateItem extends Omit<AskPiece, 'item_type' | 'colour_family'> {
  slot: Slot
  compat: number
}

export interface AskCandidate {
  candidateIndex: number
  score: number
  similarity: number
  confidence: number
  lane: 'fast' | 'standard'
  reasons: string[]
  statement: string | null
  echoes: string[]
  items: AskCandidateItem[]
}

export interface AskResult {
  anchor?: AskPiece & { existingCount: number }
  /** Other pieces that fit the anchor's words — pick one to rebuild around it. */
  anchorAlternatives?: AskPiece[]
  candidates?: AskCandidate[]
  /** How each piece she named was read, and what it found. */
  pieces?: { label: string; found: number; relaxed: string | null; byAnchor?: boolean }[]
  notes?: string[]
  error?: string
}

function fmtPrice(it: { price?: unknown; price_gbp?: unknown; currency?: unknown }): string {
  const { gbp } = priceOfItem(it)
  if (gbp != null) return `£${Math.round(gbp)}`
  return it.price ? String(it.price) : ''
}

function piecePayload(it: ItemWithBrand): AskPiece {
  return {
    item_id: it.item_id,
    product_name: it.product_name,
    brand_name: it.brand?.name ?? null,
    image_url: it.image_url,
    item_type: String(it.item_type),
    colour_family: (it as any).colour_family ?? null,
    price: fmtPrice(it as any),
    stock_status: ((it as any).stock_status ?? null) as AskPiece['stock_status'],
    stock_sizes: ((it as any).stock_sizes ?? null) as string[] | null,
  }
}

// Two pieces that cannot both be worn: two dresses, two pairs of shoes, a
// dress with a separate top or bottom. Jewellery and accessories layer.
function clashes(a: Slot, b: Slot): boolean {
  if (a === 'jewellery' || a === 'accessory' || b === 'jewellery' || b === 'accessory') return false
  if (a === b) return true
  const pair = new Set([a, b])
  return pair.has('dress') && (pair.has('top') || pair.has('bottom'))
}

// The garment slots a look still needs once these are in it.
function missingSlots(present: Slot[]): Slot[] {
  const have = new Set(present)
  const need: Slot[] = have.has('dress') ? ['shoe'] : ['top', 'bottom', 'shoe']
  return need.filter((s) => !have.has(s))
}

async function outfitsWith(itemId: string): Promise<number> {
  try {
    const { data } = await (createAdminClient() as any)
      .from('outfit_item')
      .select('outfit_id, outfit:outfit_id(status)')
      .eq('item_id', itemId)
    return new Set(((data ?? []) as any[]).filter((r) => r.outfit?.status !== 'archived').map((r) => r.outfit_id)).size
  } catch {
    return 0
  }
}

export async function composeFromAsk(
  ask: string,
  anchorItemId: string | null = null,
  // anchorFromAsk: the anchor was picked from this ask's own alternatives, so
  // it stands for her lead piece even where it only fits that piece loosely.
  opts: { surface?: 'composer' | 'review'; keepAnchor?: boolean; anchorFromAsk?: boolean } = {},
): Promise<AskResult> {
  try {
    const text = ask.trim()
    if (!text) return { error: 'Say what the look is — e.g. a long dress and brown boots' }

    const library = await getReadyAndLiveItems()
    // An empty pool is a failed read (a busy database), never an empty library.
    if (library.length === 0) return { error: 'The library didn’t load — the database is busy. Try again in a moment' }
    const brands =Array.from(new Set(library.map((i) => i.brand?.name).filter(Boolean) as string[]))
    const { pieces: asked } = parseOutfitAsk(text, brands)
    if (asked.length === 0) {
      return { error: `Couldn’t find a piece in “${text}” — name a garment, a colour, a cloth or a brand` }
    }
    const pool = library.filter((i) => i.image_url && sellable(i as any))
    const notes: string[] = []

    let anchor: ItemWithBrand | null = anchorItemId ? await getItem(anchorItemId) : null
    if (anchorItemId && !anchor) return { error: 'Anchor not found' }

    // A piece the anchor already is ("a blue dress" when the anchor is one)
    // is the anchor. A piece that would take the anchor's place starts a new
    // look — unless the caller is one anchor's card, which keeps its anchor.
    let wanted: PieceSpec[] = asked
    const byAnchor = new Set<PieceSpec>()
    if (anchor) {
      const a = anchor
      const aSlot = slotForItemType(a.item_type)
      for (const p of asked) {
        if (matchesPiece(a as any, p, opts.anchorFromAsk ? 'no-brand' : 'no-cloth')) { byAnchor.add(p); if (opts.anchorFromAsk) break }
      }
      wanted = asked.filter((p) => !byAnchor.has(p))
      const clash = wanted.find((p) => { const s = slotOfPiece(p); return s != null && clashes(aSlot, s) })
      if (clash) {
        if (opts.keepAnchor) {
          return { error: `“${clash.label}” would take the anchor’s place — ask for what goes with it` }
        }
        notes.push(`“${clash.label}” can’t sit beside the anchor, so this is a new look built from your words`)
        anchor = null
        byAnchor.clear()
        wanted = asked
      }
    }

    const [model, constraints, approvedVectors, config, learnedPairs] = await Promise.all([
      loadStyleModel(),
      loadEjectionConstraints(),
      loadApprovedVectors(500),
      loadPipelineConfig(),
      loadLearnedMaterialPairs(),
    ])

    const compatWith = (a: ItemWithBrand | null) => (it: ItemWithBrand) => (a ? pairCompat(a, it).total : 0)
    let ranked = wanted.map((spec) =>
      rankForPiece(pool.filter((i) => i.item_id !== anchor?.item_id), spec, { limit: 8, score: compatWith(anchor) }))
    // How each piece she named was read, in her order, for the UI.
    const rows = new Map<PieceSpec, { label: string; found: number; relaxed: string | null; byAnchor?: boolean }>()
    for (const p of Array.from(byAnchor)) rows.set(p, { label: p.label, found: 1, relaxed: null, byAnchor: true })
    for (const r of ranked) {
      rows.set(r.spec, { label: r.spec.label, found: r.total, relaxed: r.relaxed })
      // What she named may be in the library but not buyable — say so rather
      // than quietly offering something else.
      if (r.level !== 'exact' || r.total === 0) {
        const unsellable = rankForPiece(library.filter((i) => !sellable(i as any)), r.spec, { limit: 1 })
        if (unsellable.level === 'exact' && unsellable.total > 0) {
          notes.push(`${unsellable.total === 1 ? `${unsellable.items[0].product_name} is` : `${unsellable.total} pieces matching “${r.spec.label}” are`} out of stock or unreadable, so not offered`)
        }
      }
      if (r.total === 0) notes.push(`Nothing in the library for “${r.spec.label}”`)
    }
    const summary = () => asked.map((p) => rows.get(p)).filter((x): x is NonNullable<typeof x> => !!x)
    ranked = ranked.filter((r) => r.total > 0)

    // Built from nothing: the piece the look is worn around becomes the
    // anchor, and of its matches the one that sits best with the rest.
    let anchorAlternatives: AskPiece[] = []
    if (!anchor) {
      if (ranked.length === 0) return { pieces: summary(), notes, error: 'Nothing in the library matches those pieces' }
      const slotOf = (r: (typeof ranked)[number]) => slotOfPiece(r.spec) ?? slotForItemType(r.items[0].item_type)
      const lead = ranked
        .map((r, i) => ({ r, i, p: ANCHOR_PRIORITY.indexOf(slotOf(r)) }))
        .sort((a, b) => a.p - b.p || a.i - b.i)[0].r
      const others = ranked.filter((r) => r !== lead)
      const fit = (it: ItemWithBrand, idx: number) =>
        others.reduce((s, r) => s + Math.max(0, ...r.items.slice(0, 4).map((o) => pairCompat(it, o).total)), 0) - idx * 0.02
      const choices = lead.items.slice(0, 6)
      anchor = choices.map((it, idx) => ({ it, s: fit(it, idx) })).sort((a, b) => b.s - a.s)[0].it
      anchorAlternatives = lead.items.filter((i) => i.item_id !== anchor!.item_id).slice(0, 8).map(piecePayload)
      rows.set(lead.spec, { ...rows.get(lead.spec)!, byAnchor: true })
      // Re-rank the rest against the anchor now there is one.
      ranked = others.map((r) => rankForPiece(pool.filter((i) => i.item_id !== anchor!.item_id), r.spec, { limit: 8, score: compatWith(anchor) }))
    }
    const a = anchor!
    const aSlot = slotForItemType(a.item_type)
    for (const r of ranked) rows.set(r.spec, { ...rows.get(r.spec)!, relaxed: r.relaxed })
    const pieceSummary = summary()

    // Her pieces' options — fewer each the more pieces she named, so the
    // combinations stay small — then the slots a look still needs.
    const k = ranked.length <= 2 ? 5 : ranked.length === 3 ? 4 : 3
    const lists: { items: { item: ItemWithBrand; slot: Slot }[]; filler: Slot | null }[] = ranked.map((r) => ({
      items: r.items.slice(0, k).map((item) => ({ item, slot: slotForItemType(item.item_type) })),
      filler: null,
    }))
    const present: Slot[] = [aSlot, ...lists.map((l) => l.items[0].slot)]
    const named = new Set(lists.flatMap((l) => l.items.map((x) => x.item.item_id)))
    const band = formalityBand([a])
    const aTier = a.brand?.price_tier ?? null
    for (const slot of missingSlots(present)) {
      const options = pool
        .filter((i) => i.item_id !== a.item_id && !named.has(i.item_id) && slotForItemType(i.item_type) === slot)
        .filter((i) => !isExcluded(constraints, i.item_id, slot, band))
        .filter((i) => !tierBandViolation([aTier, i.brand?.price_tier ?? null]))
        .map((item) => ({
          item,
          s: pairCompat(a, item).total +
            lists.reduce((sum, l) => sum + pairCompat(l.items[0].item, item).total, 0) / Math.max(1, lists.length),
        }))
        .sort((x, y) => y.s - x.s)
        .slice(0, FILLERS_PER_SLOT)
        .map(({ item }) => ({ item, slot }))
      if (options.length > 0) lists.push({ items: options, filler: slot })
    }

    // Every combination, scored the way rescoreCandidate scores an edit.
    const combos: { picks: { item: ItemWithBrand; slot: Slot; listIdx: number; rank: number }[]; score: number }[] = []
    const walk = (i: number, acc: { item: ItemWithBrand; slot: Slot; listIdx: number; rank: number }[]) => {
      if (combos.length >= MAX_COMBOS) return
      if (i === lists.length) {
        const ids = new Set(acc.map((x) => x.item.item_id))
        if (ids.size !== acc.length) return
        // Her pieces must still be wearable together (two typeless matches can land in one slot).
        for (let x = 0; x < acc.length; x++) {
          if (clashes(aSlot, acc[x].slot)) return
          for (let y = x + 1; y < acc.length; y++) if (clashes(acc[x].slot, acc[y].slot)) return
        }
        let sum = 0, weight = 0
        for (const p of acc) { sum += pairCompat(a, p.item).total * 2; weight += 2 }
        for (let x = 0; x < acc.length; x++) {
          for (let y = x + 1; y < acc.length; y++) { sum += pairCompat(acc[x].item, acc[y].item).total; weight += 1 }
        }
        const coherence = weight ? sum / weight : 0
        // Her best-matching pieces first: a small nudge per place down a list.
        const fidelity = acc.reduce((s, p) => s + (lists[p.listIdx].filler ? 0 : p.rank * 0.01), 0)
        combos.push({ picks: acc, score: coherence - fidelity })
        return
      }
      lists[i].items.forEach((x, rank) => walk(i + 1, [...acc, { ...x, listIdx: i, rank }]))
    }
    walk(0, [])
    if (lists.length > 0 && combos.length === 0) {
      return { anchor: { ...piecePayload(a), existingCount: 0 }, pieces: pieceSummary, notes, error: 'Those pieces can’t be worn together' }
    }
    if (lists.length === 0) combos.push({ picks: [], score: 0 })

    // House Style Constitution on the best, as the Composer reads it — a look
    // you asked for is never refused, but the rules it breaks are named and
    // the clean ones lead.
    const houseOpts = {
      learnedApprovedPairs: learnedPairs.approved,
      learnedRejectedPairs: learnedPairs.rejected,
      softSkipPairs: hardSkipPairs(model),
    }
    const judged = combos
      .sort((x, y) => y.score - x.score)
      .slice(0, 80)
      .map((c) => ({
        ...c,
        verdict: evaluateHouseStyle([toHouseItem(a, aSlot), ...c.picks.map((p) => toHouseItem(p.item, p.slot))], houseOpts),
      }))
      .sort((x, y) => Number(y.verdict.pass) - Number(x.verdict.pass) || y.score - x.score)

    // Six different looks; no piece in more than two of them while her list
    // for it has others to offer.
    const uses = new Map<string, number>()
    const seen = new Set<string>()
    const chosen: typeof judged = []
    for (const c of judged) {
      if (chosen.length >= LOOKS) break
      const key = c.picks.map((p) => p.item.item_id).sort().join('|')
      if (seen.has(key)) continue
      const over = c.picks.some((p) => lists[p.listIdx].items.length > 1 && (uses.get(p.item.item_id) ?? 0) >= MAX_USES_PER_PIECE)
      if (over) continue
      seen.add(key)
      for (const p of c.picks) uses.set(p.item.item_id, (uses.get(p.item.item_id) ?? 0) + 1)
      chosen.push(c)
    }

    const relaxedNotes = ranked.map((r) => r.relaxed).filter(Boolean) as string[]
    const candidates: AskCandidate[] = chosen.map((c, idx) => {
      const entries = [{ item: a, slot: aSlot }, ...c.picks.map((p) => ({ item: p.item, slot: p.slot }))]
      const vector = vectorForCandidate(
        entries,
        deriveOccasionScores(entries),
        deriveOutfitLevelScores(a, entries.slice(1)),
        deriveSlotScores(entries),
      )
      const gate = confidenceGate({
        vector,
        approvedVectors,
        items: entries.map((e) => reviewFeature(e.item)),
        itemIds: entries.map((e) => e.item.item_id),
        itemLabels: entries.map((e) => [e.item.brand?.name, e.item.product_name].filter(Boolean).join(' ')),
        slotByItemId: Object.fromEntries(entries.map((e) => [e.item.item_id, e.slot])),
        band: formalityBand(entries.map((e) => e.item)),
        constraints,
        model,
      })
      const hv = c.verdict
      const confidence = gate.confidence - hv.penaltyTotal
      const statementIt = hv.statement ? entries.find((e) => e.item.item_id === hv.statement!.itemId)?.item : null
      const added = c.picks.filter((p) => lists[p.listIdx].filler).map((p) => p.slot)
      return {
        candidateIndex: idx,
        score: Number(Math.max(0, c.score).toFixed(3)),
        similarity: Number(gate.similarity.toFixed(3)),
        confidence: Number(confidence.toFixed(3)),
        lane: hv.pass && confidence >= config.fast_lane_threshold ? 'fast' as const : 'standard' as const,
        reasons: [
          ...(added.length ? [`MYRA added the ${added.map((s) => (s === 'shoe' ? 'shoes' : s)).join(' and ')} to finish the look`] : []),
          ...relaxedNotes,
          ...hv.violations.map((v) => `House rule — ${v.message}`),
          ...gate.reasons,
          ...hv.penalties.map((p) => p.message),
        ],
        statement: statementIt
          ? `${[statementIt.brand?.name, statementIt.product_name].filter(Boolean).join(' ')} (${hv.statement!.kind})`
          : null,
        echoes: hv.echoes,
        items: c.picks.map(({ item, slot }) => {
          const { item_type: _t, colour_family: _c, ...rest } = piecePayload(item)
          return { ...rest, slot, compat: Number(pairCompat(a, item).total.toFixed(3)) }
        }),
      }
    })

    // Every shown look is an OFFER — the denominator of approval rates.
    void recordStyleOffers(
      chosen.map((c) => ({
        items: [reviewFeature(a), ...c.picks.map((p) => reviewFeature(p.item))],
        anchorItemId: a.item_id,
        itemIds: [a.item_id, ...c.picks.map((p) => p.item.item_id)],
      })),
      opts.surface ?? 'composer',
    )

    return {
      anchor: { ...piecePayload(a), existingCount: opts.surface === 'review' ? await outfitsWith(a.item_id) : 0 },
      anchorAlternatives,
      candidates,
      pieces: pieceSummary,
      notes,
    }
  } catch (err) {
    console.error('[composeFromAsk]', err)
    return { error: err instanceof Error ? err.message : 'Could not build that look' }
  }
}
