// MYRA Mirror — top picks for the shop she has just walked into.
//
// The mirror already re-orders a brand's grid into her order (rank.ts). That
// answers "which of these first". It does not answer the question she actually
// arrives with, which is "is there anything here for me", and it never shows
// her the thing she would have to imagine: the piece ON, with her own clothes.
//
// A pick is one piece off this page, with one look built around it from her
// wardrobe AND the brands MYRA carries, and the reason it is here said plainly:
//
//   FILLS A GAP  — her wardrobe is thin in that slot (gaps.ts). Not a matter
//                  of taste: a fourth maxi dress can be perfectly on taste and
//                  still be the wrong thing to put in front of her.
//   YOUR TASTE   — her brands, her pieces, her size (rank.ts).
//
// Composing is expensive — a new piece is scored by vision before anything can
// be built around it — so this runs when she asks for it, never on page load.

import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import { listOwnedItems } from '@/lib/wardrobe/store'
import { ownerRefsForMember } from '@/lib/wardrobe/owned-items'
import { rankPageForMember, itemTypeFor, type PageProduct, type ProductScore } from './rank'
import { ensureMirrorItem, styleExternalPiece, type SiteProduct } from './style'
import { gapForItemType, gapSentence, slotOf, wardrobeGaps, type Slot } from './gaps'
import type { MirrorMember } from './auth'
import type { StyledLook } from '@/app/admin/private-stylist/actions'

/** A tile as the extension reads it — the rank payload plus its picture. */
export interface PickCandidate extends PageProduct {
  image?: string | null
}

export interface MirrorPick {
  key: string
  url: string
  title: string
  brand: string | null
  image: string
  price: number | null
  /** The hero's item id, so the panel can ring it inside its own look. */
  hero_item_id: string | null
  /** Why this one: her wardrobe is short of it, or it is simply hers. */
  reason: 'gap' | 'taste'
  headline: string
  note: string
  confidence: number
  /** One look around it, from her wardrobe and MYRA's brands together. */
  look: StyledLook | null
  lookError?: string
}

export interface PicksResult {
  picks: MirrorPick[]
  /** Thin slots behind the gap picks, so the panel can name them if it wants. */
  gaps: { slot: Slot; owned: number }[]
  error?: string
}

/** How many she is shown. Three is a glance; more is a catalogue. */
const PICKS = 3
/**
 * Below this MYRA does not believe in the piece, and a gap is not a reason to
 * put something she would dislike in front of her — a thin slot decides the
 * ORDER of the picks, never whether a bad one is shown.
 */
const MIN_SCORE = 0.4

const WHY_NOTE: Record<string, string> = {
  named: 'One of your brands',
  wardrobe: 'You own pieces by them',
  shopped: 'You shop them',
  liked: 'You have liked them',
  learned: 'Learned from your decisions',
  similar: 'Close to your brands',
  input_only: '',
  baseline: '',
}

function tasteNote(s: ProductScore): string {
  const reasons = (s.reasons ?? []).filter(Boolean)
  if (reasons.length) return reasons.slice(0, 2).join(' · ')
  return WHY_NOTE[s.why] || 'Closest to your taste on this page'
}

const usable = (p: PickCandidate): p is PickCandidate & { url: string; title: string; image: string } =>
  typeof p.url === 'string' && /^https?:\/\//.test(p.url)
  && typeof p.title === 'string' && p.title.trim().length > 1
  && typeof p.image === 'string' && /^https?:\/\//.test(p.image)

/**
 * Her picks off this page. Ranks everything, reads her wardrobe for thin
 * slots, chooses at most three — a gap-filler leading wherever one clears the
 * bar — and builds one blended look around each.
 */
export async function picksForPage(
  member: MirrorMember,
  host: string | null,
  products: PickCandidate[],
): Promise<PicksResult> {
  const admin = createAdminClient() as any
  const [ranked, owned] = await Promise.all([
    rankPageForMember(member, products, host),
    listOwnedItems(ownerRefsForMember({ member_id: member.member_id, auth_user_id: (member as any).auth_user_id ?? null })),
  ])
  const gaps = wardrobeGaps(owned as { item_type?: string | null }[])
  const scoreOf = new Map(ranked.products.map((s) => [s.key, s]))

  const candidates = products
    .filter(usable)
    .map((p) => {
      const score = scoreOf.get(p.key)
      const itemType = itemTypeFor(p)
      return { p, score, itemType, slot: slotOf(itemType), gap: gapForItemType(itemType, gaps) }
    })
    // A piece MYRA cannot type cannot be composed around, so it can never be a
    // pick however well its brand scores.
    .filter((c) => c.score && c.itemType && c.score.fit !== 'no' && c.score.score >= MIN_SCORE)
    .sort((a, b) => (b.score!.score - a.score!.score))

  if (!candidates.length) {
    return { picks: [], gaps: gaps.map((g) => ({ slot: g.slot, owned: g.owned })), error: 'Nothing on this page is close enough to your taste yet' }
  }

  // Gap-fillers first, then taste — and never two picks from the same slot, or
  // she is shown three versions of the same decision.
  const chosen: typeof candidates = []
  const takenSlots = new Set<Slot>()
  const take = (list: typeof candidates) => {
    for (const c of list) {
      if (chosen.length >= PICKS) return
      if (c.slot && takenSlots.has(c.slot)) continue
      chosen.push(c)
      if (c.slot) takenSlots.add(c.slot)
    }
  }
  take(candidates.filter((c) => c.gap))
  take(candidates.filter((c) => !c.gap))
  // Her wardrobe may be thin in one slot only, and this page may be all of it:
  // rather than show one pick, loosen the slot rule before showing fewer.
  if (chosen.length < PICKS) {
    for (const c of candidates) {
      if (chosen.length >= PICKS) break
      if (!chosen.includes(c)) chosen.push(c)
    }
  }

  const picks = await Promise.all(chosen.map(async (c): Promise<MirrorPick> => {
    const site: SiteProduct = {
      url: c.p.url!, title: c.p.title!, brand: c.p.brand ?? null, type: c.p.type ?? null,
      price: c.p.price ?? null, image: (c.p as any).image, available: c.p.available ?? null,
    }
    const base: MirrorPick = {
      key: c.p.key,
      url: c.p.url!,
      title: c.p.title!,
      brand: c.p.brand ?? null,
      image: (c.p as any).image,
      price: c.p.price ?? null,
      hero_item_id: null,
      reason: c.gap ? 'gap' : 'taste',
      headline: c.gap ? 'Fills a gap' : 'Your taste',
      note: c.gap ? gapSentence(c.gap) : tasteNote(c.score!),
      confidence: c.score!.confidence,
      look: null,
    }
    try {
      const ensured = await ensureMirrorItem(site, member, admin)
      if (!ensured.item) return { ...base, lookError: ensured.error ?? 'MYRA could not read this piece' }
      // The quick pass: composed, not yet checked. The panel is a glance, and
      // a look check on three heroes is a minute she is not going to wait.
      const styled = await styleExternalPiece(ensured.item, 'blend', member, admin, { check: false })
      return {
        ...base,
        hero_item_id: ensured.item.item_id ?? null,
        look: styled.looks[0] ?? null,
        ...(styled.looks.length ? {} : { lookError: styled.error ?? 'Nothing MYRA would put with it yet' }),
      }
    } catch (e) {
      return { ...base, lookError: e instanceof Error ? e.message : String(e) }
    }
  }))

  return { picks, gaps: gaps.map((g) => ({ slot: g.slot, owned: g.owned })) }
}
