// THREADS — what MYRA has come to know about her, in one place.
//
// Not a settings page: a reading. Every thread is drawn from something she has
// actually done — pieces she owns, pictures she keeps, brands she named, looks
// she said yes and no to, the sizes she wears — and carries the evidence that
// made it. Where a thread came from two places at once (her wardrobe AND her
// pictures), it is stronger, because that is the point: everything pulling on
// everything else.
//
// Nothing here is stored. It is rebuilt from her own records each time, so it
// can never drift from what is true.

import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '@/lib/supabase-server'
import { listOwnedItems } from '@/lib/wardrobe/store'
import { ownerRefsForMember } from '@/lib/wardrobe/owned-items'
import { readStylePrefs } from '@/lib/pilot-stylist'
import { loadMemberSizeProfile } from '@/lib/size-availability'
import { CATEGORY_LABEL, SIZE_CATEGORIES, shortSizeLabel } from '@/lib/size-canonical'
import { slotForItemType } from '@/lib/composer'

export interface ThreadEvidence {
  /** Where it came from: her wardrobe, her pictures, her brands, her answers. */
  from: string
  detail: string
}

export interface Thread {
  id: string
  title: string
  /** One plain sentence, in her terms. */
  line: string
  evidence: ThreadEvidence[]
  /** How many separate places agree — what makes a thread worth trusting. */
  strength: number
}

export interface ThreadsView {
  firstName: string
  /** Her style in two sentences — every thread pulled together. */
  portrait: string | null
  /** What MYRA can reasonably infer beyond what she has shown it. */
  inferences: string[]
  /** The whole picture in two or three sentences. */
  opening: string
  threads: Thread[]
  /** What MYRA still has too little of to say anything about. */
  thin: string[]
  counts: { pieces: number; pictures: number; looks: number; yes: number; no: number; brands: number }
}

const tidy = (s: string) => s.replace(/_/g, ' ').toLowerCase()

/** Pieces said the way she would say them: sandals, not sandal. */
const PLURAL: Record<string, string> = {
  sandal: 'sandals', boot: 'boots', flat: 'flats', heel: 'heels', sneaker: 'trainers', mule: 'mules',
  trousers: 'trousers', jeans: 'jeans', shorts: 'shorts',
}
const plural = (t: string) => PLURAL[t] ?? t

/** The n things that come up most, with their counts. */
function top<T>(values: T[], n: number): { value: T; count: number }[] {
  const m = new Map<T, number>()
  for (const v of values) if (v != null && v !== '') m.set(v, (m.get(v) ?? 0) + 1)
  return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, n).map(([value, count]) => ({ value, count }))
}

const list = (parts: string[]): string =>
  parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`

/** A 1-5 dimension read back as the word she would use. */
function lengthWord(avg: number): string | null {
  if (avg >= 4.2) return 'maxi lengths'
  if (avg >= 3.4) return 'midi lengths'
  if (avg <= 1.8) return 'short lengths'
  return null
}
function fitWord(avg: number): string | null {
  if (avg >= 4.2) return 'oversized'
  if (avg >= 3.4) return 'roomy'
  if (avg <= 1.8) return 'close to the body'
  return null
}

export async function buildThreads(memberId: string): Promise<ThreadsView> {
  const admin = createAdminClient() as any
  const { data: member } = await admin.from('pilot_member').select('*').eq('member_id', memberId).maybeSingle()
  const firstName = ((member?.name as string) ?? '').split(' ')[0] ?? ''
  const prefs = readStylePrefs(member)

  const owners = ownerRefsForMember({ member_id: memberId, auth_user_id: member?.auth_user_id })
  const [owned, sizeCtx] = await Promise.all([
    listOwnedItems(owners).catch(() => []),
    loadMemberSizeProfile(memberId).catch(() => null),
  ])

  const ownerIds = [memberId, member?.auth_user_id].filter(Boolean)
  const [{ data: pics }, { data: looks }] = await Promise.all([
    admin.from('inspiration_image').select('scores, occasion_read').in('user_id', ownerIds).in('status', ['scored', 'confirmed']),
    admin.from('pilot_look')
      .select('items, response, delivery:delivery_id!inner(member_id)')
      .eq('delivery.member_id', memberId),
  ])

  const pictures = ((pics ?? []) as any[]).map((p) => p.scores).filter(Boolean)
  const pictureOccasions = ((pics ?? []) as any[]).flatMap((p) => (p.occasion_read ?? []) as string[])
  const allLooks = (looks ?? []) as any[]
  const yes = allLooks.filter((l) => l.response === 'yes')
  const no = allLooks.filter((l) => l.response === 'no')

  const lookItemIds = Array.from(new Set([...yes, ...no].flatMap((l) => ((l.items ?? []) as any[]).map((i) => i.item_id)).filter(Boolean)))
  const pieceOf = new Map<string, any>()
  for (let i = 0; i < lookItemIds.length; i += 400) {
    const { data } = await admin.from('item').select('item_id, item_type, colour_family, length, fit, pattern')
      .in('item_id', lookItemIds.slice(i, i + 400))
    for (const r of (data ?? []) as any[]) pieceOf.set(r.item_id, r)
  }
  const piecesIn = (l: any) => ((l.items ?? []) as any[]).map((i) => pieceOf.get(i.item_id)).filter(Boolean)

  // ── What she reaches for ─────────────────────────────────────────────────
  const ownedColours = top(owned.map((i: any) => i.colour_family as string), 4)
  const yesColours = top(yes.flatMap((l) => piecesIn(l).map((i) => i.colour_family as string)), 4)
  const pictureColours: { value: string; count: number }[] = []

  const ownedTypes = top(owned.map((i: any) => i.item_type as string), 5)
  const pictureTypes = top(pictures.flatMap((p: any) => (p.item_types ?? []) as string[]), 5)

  const brandsNamed: string[] = ((member?.brands ?? []) as any[]).map((b) => b?.name).filter(Boolean)
  const ownedBrands = top(owned.map((i: any) => i.brand?.name as string), 5)
  const yesBrands = top(yes.flatMap((l) => ((l.items ?? []) as any[]).map((i) => i.brand as string)), 5)

  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)
  const lengths = owned.map((i: any) => i.length).filter((n: any) => typeof n === 'number')
  const fits = owned.map((i: any) => i.fit).filter((n: any) => typeof n === 'number')

  const threads: Thread[] = []
  const add = (t: Thread) => { if (t.evidence.length) threads.push(t) }

  // Colour
  {
    const evidence: ThreadEvidence[] = []
    if (ownedColours.length) evidence.push({ from: 'Your wardrobe', detail: list(ownedColours.slice(0, 3).map((c) => `${tidy(String(c.value))} (${c.count})`)) })
    if (yesColours.length) evidence.push({ from: 'Looks you said yes to', detail: list(yesColours.slice(0, 3).map((c) => tidy(String(c.value)))) })
    if (pictureColours.length) evidence.push({ from: 'Your pictures', detail: list(pictureColours.map((c) => tidy(String(c.value)))) })
    if (prefs.colours_loved.length) evidence.push({ from: 'What you told MYRA', detail: list(prefs.colours_loved.map(tidy)) })
    const lead = ownedColours[0] ?? yesColours[0]
    add({
      id: 'colour',
      title: 'The colours you keep coming back to',
      line: lead ? `You dress in ${list(Array.from(new Set([ownedColours[0], yesColours[0]].filter(Boolean).map((c) => tidy(String(c!.value))))))}, and MYRA builds from there.` : '',
      evidence,
      strength: evidence.length,
    })
  }

  // Shape
  {
    const evidence: ThreadEvidence[] = []
    const words = [lengthWord(avg(lengths)), fitWord(avg(fits))].filter(Boolean) as string[]
    if (words.length) evidence.push({ from: 'The cut of what you own', detail: list(words) })
    if (prefs.shapes_loved.length) evidence.push({ from: 'What you told MYRA', detail: list(prefs.shapes_loved.map(tidy)) })
    if (pictures.length >= 3) {
      const volume = avg(pictures.map((p: any) => p.volume).filter((n: any) => typeof n === 'number'))
      if (volume >= 3.6) evidence.push({ from: 'Your pictures', detail: 'volume, room to move' })
      else if (volume <= 2.2) evidence.push({ from: 'Your pictures', detail: 'a clean, narrow line' })
    }
    add({
      id: 'shape',
      title: 'The shapes that are yours',
      line: words.length ? `You wear ${list(words)} — MYRA keeps to that line.` : 'MYRA is still reading your shapes.',
      evidence,
      strength: evidence.length,
    })
  }

  // The pieces themselves
  {
    const evidence: ThreadEvidence[] = []
    if (ownedTypes.length) evidence.push({ from: 'Your wardrobe', detail: list(ownedTypes.slice(0, 4).map((t) => `${tidy(String(t.value))} (${t.count})`)) })
    if (prefs.types_loved.length) evidence.push({ from: 'What you told MYRA', detail: list(prefs.types_loved.map(tidy)) })
    if (pictureTypes.length) evidence.push({ from: 'Your pictures', detail: list(pictureTypes.slice(0, 4).map((t) => tidy(String(t.value)))) })
    add({
      id: 'pieces',
      title: 'What you reach for',
      line: ownedTypes.length ? `${list(ownedTypes.slice(0, 3).map((t) => tidy(String(t.value))))} do the work in your wardrobe.` : '',
      evidence,
      strength: evidence.length,
    })
  }

  // Brands
  {
    const evidence: ThreadEvidence[] = []
    if (brandsNamed.length) evidence.push({ from: 'Brands you named', detail: list(brandsNamed.slice(0, 5)) })
    if (ownedBrands.length) evidence.push({ from: 'Brands you own', detail: list(ownedBrands.slice(0, 4).map((b) => String(b.value))) })
    if (yesBrands.length) evidence.push({ from: 'Brands in your yeses', detail: list(yesBrands.slice(0, 4).map((b) => String(b.value))) })
    add({
      id: 'brands',
      title: 'The houses you trust',
      line: brandsNamed.length || ownedBrands.length
        ? `${list(Array.from(new Set([...brandsNamed.slice(0, 3), ...ownedBrands.slice(0, 2).map((b) => String(b.value))])).slice(0, 4))} — and MYRA looks for what sits beside them.`
        : '',
      evidence,
      strength: evidence.length,
    })
  }

  // What she says no to
  {
    const evidence: ThreadEvidence[] = []
    if (prefs.types_avoided.length) evidence.push({ from: 'Never send', detail: list(prefs.types_avoided.map(tidy)) })
    if (prefs.colours_avoided.length) evidence.push({ from: 'Colours you avoid', detail: list(prefs.colours_avoided.map(tidy)) })
    if (prefs.shapes_avoided.length) evidence.push({ from: 'Shapes you avoid', detail: list(prefs.shapes_avoided.map(tidy)) })
    if (no.length) evidence.push({ from: 'Looks you turned down', detail: `${no.length} so far` })
    add({
      id: 'no',
      title: 'What you have said no to',
      line: prefs.types_avoided.length ? `No ${list(prefs.types_avoided.map(tidy))} — MYRA does not send them.` : 'MYRA is still learning your nos.',
      evidence,
      strength: evidence.length,
    })
  }

  // Fit and size
  {
    const evidence: ThreadEvidence[] = []
    const sizes = sizeCtx
      ? SIZE_CATEGORIES.filter((c) => sizeCtx.profile[c]?.value != null)
        .map((c) => `${CATEGORY_LABEL[c].toLowerCase()} ${shortSizeLabel(sizeCtx.profile[c]!.value as number)}`)
      : []
    if (sizes.length) evidence.push({ from: 'Your sizes', detail: list(sizes) })
    add({
      id: 'fit',
      title: 'What fits you',
      line: sizes.length ? `${list(sizes)} — nothing outside that reaches you.` : '',
      evidence,
      strength: evidence.length,
    })
  }

  // The outfits she says yes to — the formula, not just the pieces
  {
    const formula = (l: any): string | null => {
      const bySlot = new Map<string, string>()
      for (const it of piecesIn(l)) {
        if (!it.item_type) continue
        const slot = slotForItemType(it.item_type)
        if (['dress', 'top', 'bottom', 'outerwear', 'shoe'].includes(slot) && !bySlot.has(slot)) bySlot.set(slot, plural(tidy(it.item_type)))
      }
      const order = ['dress', 'bottom', 'top', 'outerwear', 'shoe'].map((k) => bySlot.get(k)).filter(Boolean) as string[]
      return order.length >= 2 ? order.join(' + ') : null
    }
    const yesFormulas = top(yes.map(formula).filter(Boolean) as string[], 3)
    const shoesIn = (ls: any[]) => top(ls.flatMap((l) => piecesIn(l).filter((i) => i.item_type && slotForItemType(i.item_type) === 'shoe').map((i) => plural(tidy(i.item_type)))), 3)
    const yesShoes = shoesIn(yes)
    const noTypes = new Set(no.flatMap((l) => piecesIn(l).map((i) => i.item_type)).filter(Boolean))
    const yesTypes = new Set(yes.flatMap((l) => piecesIn(l).map((i) => i.item_type)).filter(Boolean))
    const onlyInNo = Array.from(noTypes).filter((t) => !yesTypes.has(t)).map((t) => plural(tidy(String(t)))).slice(0, 4)
    const lengthsYes = yes.flatMap((l) => piecesIn(l).map((i) => i.length)).filter((n: any) => typeof n === 'number')

    const evidence: ThreadEvidence[] = []
    if (yesFormulas.length) evidence.push({ from: 'Looks you said yes to', detail: list(yesFormulas.map((f) => `${f.value}${f.count > 1 ? ` (${f.count})` : ''}`)) })
    if (yesShoes.length) evidence.push({ from: 'On your feet', detail: list(yesShoes.map((x) => x.value)) })
    const yesLength = lengthWord(avg(lengthsYes))
    if (yesLength) evidence.push({ from: 'The length you keep', detail: yesLength })
    if (onlyInNo.length) evidence.push({ from: 'Only in looks you turned down', detail: list(onlyInNo) })
    const lead = yesFormulas[0]?.value
    add({
      id: 'outfits',
      title: 'The outfits you say yes to',
      line: lead
        ? `Your yes is ${lead}${yesShoes[0] && !lead.includes(yesShoes[0].value) ? `, finished with ${yesShoes[0].value}` : ''}${onlyInNo.length ? ` — and ${onlyInNo[0]} ${onlyInNo[0].endsWith('s') ? 'are' : 'is'} what tips a look to no` : ''}.`
        : yes.length ? 'MYRA is still reading what your yeses have in common.' : '',
      evidence,
      strength: Math.min(3, evidence.length),
    })
  }

  // What her pictures say about the feel of an outfit
  {
    const lean = (key: string, low: string, high: string): string | null => {
      const v = avg(pictures.map((p: any) => p[key]).filter((n: any) => typeof n === 'number'))
      if (Number.isNaN(v)) return null
      if (v <= 2.3) return low
      if (v >= 3.7) return high
      return null
    }
    const feel = [
      lean('construction', 'tailored', 'soft and unstructured'),
      lean('volume', 'close to the body', 'loose and roomy'),
      lean('colour_story', 'one colour head to toe', 'strong contrasts'),
      lean('colour_depth', 'pale, light colours', 'deep, saturated colours'),
      lean('pattern', 'plain, no print', 'bold print'),
      lean('surface_story', 'clean, flat fabrics', 'texture — knits, weaves, lace'),
      lean('sheen', 'matte', 'a bit of shine'),
      lean('formality', 'everyday, never done-up', 'dressed up'),
    ].filter(Boolean) as string[]
    const moods = top(pictureOccasions.map((o) => tidy(o)), 3)
    const evidence: ThreadEvidence[] = []
    if (feel.length) evidence.push({ from: 'Across your pictures', detail: list(feel) })
    if (moods.length) evidence.push({ from: 'Where they are going', detail: list(moods.map((m) => m.value)) })
    if (pictureTypes.length >= 2) evidence.push({ from: 'The pieces in them', detail: list(pictureTypes.slice(0, 4).map((t) => tidy(String(t.value)))) })
    add({
      id: 'pictures',
      title: 'What your pictures are telling MYRA',
      line: feel.length
        ? `The outfits you keep are ${list(feel.slice(0, 3))}${moods[0] ? `, mostly for ${moods[0].value}` : ''}.`
        : pictures.length ? 'Your pictures point in a few directions — MYRA is still reading them.' : '',
      evidence,
      strength: Math.min(3, evidence.length),
    })
  }

  const ordered = threads.filter((t) => t.line).sort((a, b) => b.strength - a.strength)

  const thin: string[] = []
  if (pictures.length < 3) thin.push('Your pictures — a few more and MYRA can read the mood you keep returning to.')
  if (!owned.length) thin.push('Your own pieces — add what you already wear and every thread gets stronger.')
  if (!yes.length && !no.length) thin.push('Your answers — say yes and no to a few looks and MYRA learns fastest of all.')

  const lead = ordered[0]
  const opening = lead
    ? `${firstName ? `${firstName}, ` : ''}this is what MYRA has learned so far — pulled from ${[
      owned.length ? `${owned.length} of your own pieces` : null,
      pictures.length ? `${pictures.length} pictures you kept` : null,
      yes.length || no.length ? `${yes.length + no.length} looks you answered` : null,
      brandsNamed.length ? `${brandsNamed.length} brands you named` : null,
    ].filter(Boolean).join(', ')}.`
    : 'MYRA has not learned enough about you yet. Add a few pieces, keep some pictures, and answer a look or two.'

  // The written read (portrait + inferences) is a model call, so it is fetched
  // separately — the threads show at once and the read fills in after.
  const cached = cachedRead(memberId, ordered)

  return {
    firstName,
    portrait: cached?.portrait ?? null,
    inferences: cached?.inferences ?? [],
    opening,
    threads: ordered,
    thin,
    counts: {
      pieces: owned.length,
      pictures: pictures.length,
      looks: allLooks.length,
      yes: yes.length,
      no: no.length,
      brands: brandsNamed.length,
    },
  }
}

// ── The read: every thread pulled into one picture of her ──────────────────

const READ_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['portrait', 'inferences'],
  properties: {
    portrait: { type: 'string' },
    inferences: { type: 'array', items: { type: 'string' } },
  },
} as const

const readCache = new Map<string, { at: number; key: string; value: { portrait: string; inferences: string[] } }>()
const READ_TTL_MS = 6 * 60 * 60 * 1000

const factsOf = (threads: Thread[]) =>
  threads.map((t) => `${t.title}: ${t.line}\n${t.evidence.map((e) => `  - ${e.from}: ${e.detail}`).join('\n')}`).join('\n\n')

/** A read already made for exactly these threads, if there is one. */
function cachedRead(memberId: string, threads: Thread[]): { portrait: string; inferences: string[] } | null {
  const hit = readCache.get(memberId)
  return hit && hit.key === factsOf(threads) && Date.now() - hit.at < READ_TTL_MS ? hit.value : null
}

/** The written read for her current threads — the slow part, asked for on its own. */
export async function buildThreadsRead(memberId: string): Promise<{ portrait: string | null; inferences: string[] }> {
  const view = await buildThreads(memberId)
  if (view.portrait) return { portrait: view.portrait, inferences: view.inferences }
  const read = await readHerStyle(memberId, view.firstName, view.threads)
  return { portrait: read?.portrait ?? null, inferences: read?.inferences ?? [] }
}

/**
 * One cheap call that reads the threads together: who she dresses like, and
 * what follows from it that she has not said outright. Cached for an hour per
 * member and redone as soon as a thread changes.
 */
async function readHerStyle(memberId: string, firstName: string, threads: Thread[]): Promise<{ portrait: string; inferences: string[] } | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey || threads.length < 2) return null
  const facts = factsOf(threads)
  const key = facts
  const hit = readCache.get(memberId)
  if (hit && hit.key === key && Date.now() - hit.at < READ_TTL_MS) return hit.value
  try {
    const client = new Anthropic({ apiKey })
    const res = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 700,
      output_config: { format: { type: 'json_schema', schema: READ_SCHEMA } },
      messages: [{
        role: 'user',
        content: `You are MYRA, a private stylist, writing to ${firstName || 'your client'} about how she dresses. Below is everything learned from her wardrobe, her inspiration pictures, the brands she named and the looks she said yes and no to.

portrait: two short sentences in the second person that describe her style as a whole — the kind of outfits, the feel, the palette. Specific and plain, like a good stylist talking. Never use "effortless" or "effortlessly", "timeless", "chic", "elevated", "curated" or "considered". No exclamation marks.

inferences: 3 to 5 things you can reasonably INFER that she has not said outright — each one short sentence, second person, grounded in the evidence (e.g. what she would likely love next, what she probably finds uncomfortable, how she dresses for an occasion she has not shown). Never repeat a fact already stated; infer beyond it. No guesses about her body, age or money.

${facts}`,
      }],
    } as any) as Anthropic.Message
    const block = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
    if (!block) return null
    const raw = JSON.parse(block.text)
    const value = {
      portrait: String(raw.portrait ?? '').trim(),
      inferences: (Array.isArray(raw.inferences) ? raw.inferences : []).map((x: unknown) => String(x).trim()).filter(Boolean).slice(0, 5),
    }
    if (!value.portrait) return null
    readCache.set(memberId, { at: Date.now(), key, value })
    return value
  } catch {
    return null
  }
}
