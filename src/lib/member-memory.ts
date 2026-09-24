import { parseBrief, briefIsEmpty, briefText } from '@/lib/stylist-brief'
import 'server-only'

// WHAT MYRA KNOWS ABOUT HER — one brief, read fresh, assembled from every place
// a client leaves a trace:
//
//   her house style            the lens her looks are styled through
//   her own words              the stylist's notes, and what she says she never wears
//   what she has told MYRA     colours, shapes and pieces she loves or avoids, sizes, budget
//   what she dresses for       her occasions, in her own ticks
//   her brands                 what she named, and what she has been shown since
//   her pictures               the inspiration she keeps
//   her archival looks         photographs of what she actually wears
//   the looks she kept         MYRA's own outfits she said yes to
//   her wardrobe               the pieces she owns
//
// The composer reads these as numbers (vectors, gates, scores); this is the
// same knowledge in words, for the check that judges a look before she sees it
// and for anywhere MYRA has to explain itself. One place to add to, so a new
// kind of memory is never wired into half the system.

import { createAdminClient } from '@/lib/supabase-server'
import { describeClientForCheck } from '@/lib/look-check'
import { typeCounts } from '@/lib/reference-loves'
import { OCCASION_TYPES } from '@/lib/pilot-stylist'
import { CATEGORY_LABEL, SIZE_CATEGORIES } from '@/lib/size-canonical'
import { loadMemberSizeProfile } from '@/lib/size-availability'

const tidy = (s: string) => s.replace(/_/g, ' ')
const NOISE = new Set(['ring', 'earrings', 'bracelet', 'necklace', 'sunglasses', 'brooch'])

/** The types that keep coming up across a set of scored photos. */
function commonTypes(scored: any[], atLeast = 0.3): string[] {
  if (scored.length < 3) return []
  const counts = typeCounts(scored.map((s) => s?.item_types ?? []))
  return Array.from(counts.entries())
    .filter(([t, n]) => !NOISE.has(t) && n / scored.length >= atLeast)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([t]) => tidy(t))
}

const top = (xs: (string | null | undefined)[], n: number): string[] => {
  const counts = new Map<string, number>()
  for (const x of xs) if (x) counts.set(x, (counts.get(x) ?? 0) + 1)
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, n).map(([v]) => tidy(v))
}

export interface MemberMemory {
  /** Everything, in the words the look check reads. */
  text: string
  /** What each layer had to say — for showing Chloe where a decision came from. */
  sections: { label: string; detail: string }[]
  counts: { pictures: number; archival: number; keptLooks: number; owned: number; brands: number }
}

/**
 * Her whole memory, in words. Cached briefly: a delivery composes several looks
 * and each one is checked, and none of this changes between them.
 */
const CACHE_MS = 5 * 60 * 1000
const cache = new Map<string, { at: number; value: MemberMemory }>()

export async function memberMemory(memberId: string): Promise<MemberMemory> {
  const hit = cache.get(memberId)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value

  const admin = createAdminClient() as any
  const { data: member } = await admin.from('pilot_member').select('*').eq('member_id', memberId).maybeSingle()
  const owners = [memberId, member?.auth_user_id].filter(Boolean)

  const [{ data: assignment }, { data: pics }, { data: archival }, { data: keptLooks }, { data: owned }, sizeCtx] = await Promise.all([
    admin.from('user_persona').select('persona_id').eq('user_id', memberId).maybeSingle(),
    admin.from('inspiration_image').select('scores').in('user_id', owners).in('status', ['scored', 'confirmed']),
    admin.from('archival_look').select('analysis').eq('member_id', memberId).eq('hidden', false).not('analysis', 'is', null),
    admin.from('pilot_look').select('items, delivery:delivery_id!inner(member_id)').eq('delivery.member_id', memberId).not('approved_at', 'is', null),
    admin.from('item').select('item_type, colour_family').eq('ownership', 'owned').in('owner_user_id', owners).neq('status', 'archived'),
    loadMemberSizeProfile(memberId).catch(() => null),
  ])

  let houseStyle: string | null = null
  let houseBrief: string | null = null
  if (assignment?.persona_id) {
    const { data: persona } = await admin.from('stylist').select('name, brief').eq('stylist_id', assignment.persona_id).maybeSingle()
    houseStyle = persona?.name ?? null
    const brief = parseBrief(persona?.brief, persona?.name ?? '')
    houseBrief = briefIsEmpty(brief) ? null : briefText(persona?.name ?? '', brief)
  }

  const sections: { label: string; detail: string }[] = []
  const add = (label: string, detail: string) => { if (detail) sections.push({ label, detail }) }

  // What she has told MYRA, plus her own words — the check already knows how to read these.
  add('Her profile', describeClientForCheck(member ?? {}, houseStyle, houseBrief))

  // What she dresses for.
  const occ = (member?.occasions ?? {}) as Record<string, string>
  const lives = OCCASION_TYPES.filter((o) => occ[o.id] && occ[o.id] !== 'never').map((o) => o.label.toLowerCase())
  add('What she dresses for', lives.length ? `She dresses for: ${lives.join(', ')}. Nothing else is part of her life — never style for it.` : '')

  // Sizes, so the words agree with the gate.
  if (sizeCtx?.hasProfile) {
    const sizes = SIZE_CATEGORIES.filter((c) => sizeCtx.profile[c]?.value != null)
      .map((c) => `${CATEGORY_LABEL[c].toLowerCase()} UK ${sizeCtx.profile[c]!.value}${sizeCtx.profile[c]!.adjacent ? ` (or ${sizeCtx.profile[c]!.adjacent})` : ''}`)
    add('Her sizes', sizes.length ? `${sizes.join(', ')}.${sizeCtx.acceptsSecondHand ? ' Happy with pre-loved pieces.' : ''}` : '')
  }

  // Her brands, in the order she named them.
  const brands = ((member?.brands ?? []) as any[]).map((b) => (typeof b === 'string' ? b : b?.name)).filter(Boolean)
  add('Brands she named', brands.length ? `${brands.slice(0, 8).join(', ')}.` : '')

  // Her pictures.
  const scored = ((pics ?? []) as any[]).map((p) => p.scores).filter(Boolean)
  if (scored.length >= 3) {
    const avg = (k: string) => (scored.reduce((s, x) => s + (Number(x[k]) || 0), 0) / scored.length).toFixed(1)
    add('The pictures she keeps', `${scored.length} outfits, mostly ${commonTypes(scored).join(', ')}; formality ${avg('formality')}/5, pattern ${avg('pattern')}/5, volume ${avg('volume')}/5.`)
  }

  // Her archival looks — photographs of what she actually wears.
  const analyses = ((archival ?? []) as any[]).map((a) => a.analysis).filter(Boolean)
  if (analyses.length >= 2) {
    // The outfit read describes each piece in a sentence; the slots she wears
    // and how the looks sit (formality, volume) is what belongs in her brief.
    const slots = top(analyses.flatMap((a: any) => ((a.detected_items ?? []) as any[]).map((d) => d?.slot)), 5)
    const occasions = top(analyses.flatMap((a: any) => (a.occasion_tags ?? []) as string[]), 3)
    const avg = (k: string) => {
      const ns = analyses.map((a: any) => Number(a?.[k])).filter((n) => Number.isFinite(n))
      return ns.length ? (ns.reduce((x, y) => x + y, 0) / ns.length).toFixed(1) : null
    }
    const shape = [avg('formality') && `formality ${avg('formality')}/5`, avg('volume') && `volume ${avg('volume')}/5`, avg('pattern') && `pattern ${avg('pattern')}/5`].filter(Boolean).join(', ')
    add('What she actually wears', [
      `${analyses.length} photographs of her own outfits`,
      slots.length ? `, built from ${slots.join(', ')}` : '',
      shape ? `; they sit at ${shape}` : '',
      occasions.length ? `; worn for ${occasions.join(', ')}` : '',
      '. Style her closer to these than to anything new.',
    ].join(''))
  }

  // MYRA's own looks she said yes to.
  const keptItems = ((keptLooks ?? []) as any[]).flatMap((l) => (l.items ?? []) as any[])
  if (keptItems.length) {
    add('Looks she kept', `She has kept ${keptLooks!.length} look${keptLooks!.length === 1 ? '' : 's'}, built on ${top(keptItems.map((i: any) => i.item_type), 4).join(', ')}.`)
  }

  // Her own wardrobe.
  const ownedRows = (owned ?? []) as any[]
  if (ownedRows.length) {
    add('Her wardrobe', `${ownedRows.length} pieces of her own: mostly ${top(ownedRows.map((i) => i.item_type), 4).join(', ')} in ${top(ownedRows.map((i) => i.colour_family), 3).join(', ')}. Style around these before buying anything new.`)
  }

  const value: MemberMemory = {
    sections,
    text: sections.map((s) => `${s.label}. ${s.detail}`).join('\n'),
    counts: {
      pictures: scored.length,
      archival: analyses.length,
      keptLooks: (keptLooks ?? []).length,
      owned: ownedRows.length,
      brands: brands.length,
    },
  }
  cache.set(memberId, { at: Date.now(), value })
  return value
}

/** Forget the cached brief — after she changes her profile, or new photos land. */
export const forgetMemberMemory = (memberId: string) => cache.delete(memberId)
