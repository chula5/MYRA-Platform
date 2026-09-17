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
import { createAdminClient } from '@/lib/supabase-server'
import { listOwnedItems } from '@/lib/wardrobe/store'
import { ownerRefsForMember } from '@/lib/wardrobe/owned-items'
import { readStylePrefs } from '@/lib/pilot-stylist'
import { loadMemberSizeProfile } from '@/lib/size-availability'
import { CATEGORY_LABEL, SIZE_CATEGORIES, shortSizeLabel } from '@/lib/size-canonical'

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
  /** The whole picture in two or three sentences. */
  opening: string
  threads: Thread[]
  /** What MYRA still has too little of to say anything about. */
  thin: string[]
  counts: { pieces: number; pictures: number; looks: number; yes: number; no: number; brands: number }
}

const tidy = (s: string) => s.replace(/_/g, ' ').toLowerCase()

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
    admin.from('inspiration_image').select('scores').in('user_id', ownerIds).in('status', ['scored', 'confirmed']),
    admin.from('pilot_look')
      .select('items, response, delivery:delivery_id!inner(member_id)')
      .eq('delivery.member_id', memberId),
  ])

  const pictures = ((pics ?? []) as any[]).map((p) => p.scores).filter(Boolean)
  const allLooks = (looks ?? []) as any[]
  const yes = allLooks.filter((l) => l.response === 'yes')
  const no = allLooks.filter((l) => l.response === 'no')

  // ── What she reaches for ─────────────────────────────────────────────────
  const ownedColours = top(owned.map((i: any) => i.colour_family as string), 4)
  const yesColours = top(yes.flatMap((l) => ((l.items ?? []) as any[]).map((i) => i.colour_family as string)), 4)
  const pictureColours = top(pictures.flatMap((p: any) => (p.colour_story ? [String(p.colour_story)] : [])), 3)

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

  return {
    firstName,
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
