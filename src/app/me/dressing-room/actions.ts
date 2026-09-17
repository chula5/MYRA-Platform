'use server'

// The browser-callable surface of the Dressing Room. The implementations live in
// the private-stylist module (plain, not 'use server') and resolve the member on
// the server themselves — her session, or the member Chloe names when testing
// from HER VIEW, honoured only for the admin (lib/client-member). Nothing here
// trusts an id from the browser.

import * as impl from '@/app/admin/private-stylist/actions'

export async function loadMyDressingRoom(asMemberId?: string): Promise<impl.DressingRoomView> {
  return impl.loadDressingRoom(asMemberId)
}

export async function loadMyPiece(itemId: string, asMemberId?: string): Promise<impl.OwnedPieceView> {
  return impl.loadOwnedPiece(itemId, asMemberId)
}

export async function styleMyPiece(
  itemId: string,
  opts: { occasion?: string | null; withType?: string | null },
  asMemberId?: string,
): Promise<{ looks: impl.StyledLook[]; hidden?: number; error?: string }> {
  return impl.styleOwnedPiece(itemId, opts, asMemberId)
}

/** Her looks that already use this piece — no composing, nothing paid for. */
export async function myLooksWithPiece(itemId: string, asMemberId?: string): Promise<{ looks: impl.StyledLook[]; error?: string }> {
  return impl.looksWithOwnedPiece(itemId, asMemberId)
}
