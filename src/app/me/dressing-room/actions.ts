'use server'

// The browser-callable surface of the Dressing Room. The implementations live in
// the private-stylist module (plain, not 'use server') and resolve the member on
// the server themselves — her session, or the member Chloe names when testing
// from HER VIEW, honoured only for the admin (lib/client-member). Nothing here
// trusts an id from the browser.

import * as impl from '@/app/admin/private-stylist/actions'
import { resolveClientMember } from '@/lib/client-member'
import type { LookItem } from '@/lib/pilot-stylist'
import type { AskSwapOption } from '@/app/admin/private-stylist/actions'

export async function loadMyDressingRoom(asMemberId?: string): Promise<impl.DressingRoomView> {
  return impl.loadDressingRoom(asMemberId)
}

export async function loadMyPiece(itemId: string, asMemberId?: string): Promise<impl.OwnedPieceView> {
  return impl.loadOwnedPiece(itemId, asMemberId)
}

export async function styleMyPiece(
  itemId: string,
  opts: { occasion?: string | null; withType?: string | null; shuffle?: number; query?: string | null },
  asMemberId?: string,
): Promise<{ looks: impl.StyledLook[]; hidden?: number; error?: string; read?: string | null }> {
  return impl.styleOwnedPiece(itemId, opts, asMemberId)
}

/**
 * ACCEPT one of these outfits into her looks — admin only, from HER VIEW. It
 * lands in DELIVERIES as an approved look she can like or dislike, and teaches
 * the composer exactly as keeping a test look does.
 */
export async function keepStyledLook(
  items: LookItem[],
  why: string,
  occasion: string | null,
  asMemberId?: string,
): Promise<{ deliveryId?: string; error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me || !me.test) return { error: 'Only her stylist can send a look to her looks' }
  const occ = occasion || 'casual_day'
  const mix = await impl.effectiveWeightsForMember(me.memberId, occ)
  return impl.keepAskPreview(me.memberId, occ, null, why || '', mix, [{ items, notes: why || null }], [], false)
}

/** SWAP a piece in an outfit MYRA built for her. Ranking only — nothing saved. */
export async function swapInMyOutfit(
  items: LookItem[],
  itemIndex: number,
  filters: { q?: string; brand?: string; colour?: string; itemType?: string } = {},
  asMemberId?: string,
): Promise<{ options?: AskSwapOption[]; brands?: { name: string; count: number }[]; types?: string[]; error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { error: 'Not signed in' }
  return impl.swapOwnedLookItem(me.memberId, items, itemIndex, filters)
}

/** Her looks that already use this piece — no composing, nothing paid for. */
export async function myLooksWithPiece(itemId: string, asMemberId?: string): Promise<{ looks: impl.StyledLook[]; error?: string }> {
  return impl.looksWithOwnedPiece(itemId, asMemberId)
}
