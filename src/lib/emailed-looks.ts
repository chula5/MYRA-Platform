// EMAILED TO YOU — what MYRA puts in an email is kept as her looks, exactly
// as sent.
//
// Chloe, 2026-10-20: she opened the overnight note, tapped the Twinset belt's
// outfits, and MYRA started styling it all over again — the belt had sold out
// since, every kept way around it had been retired, and the page went back to
// the eye. An outfit in her inbox is a promise: the link opens THOSE outfits,
// instantly, and they live on in her Looks under EMAILED TO YOU. So when a
// note goes out, its outfits are written as one delivery of looks first, and
// every link in the email points at them, never at the ways memory (which
// rightly forgets a look the moment a piece stops being sellable).

import type { LookItem } from '@/lib/pilot-stylist'

/** Every emailed delivery's request_text starts with this — it is how Looks finds them. */
export const EMAILED_PREFIX = 'Emailed to you'

export const isEmailedRequest = (requestText: string | null | undefined) =>
  !!requestText && requestText.startsWith(EMAILED_PREFIX)

/** request_text of a look she saved herself (me/ways/actions saveMyOutfit). */
export const SAVED_REQUEST_TEXT = 'Saved from WAYS TO WEAR IT'

/**
 * Where a look came from — the shelves of her Looks room:
 *   emailed  MYRA sent it in a note
 *   saved    she saved it herself (WAYS TO WEAR IT, STYLE IT)
 *   asked    she asked for it (an occasion)
 *   for_you  MYRA's own, for inspiration
 */
export type LookSource = 'emailed' | 'saved' | 'asked' | 'for_you'

export function lookSourceOf(d: { trigger?: string | null; request_text?: string | null } | undefined): LookSource {
  if (!d) return 'for_you'
  if (isEmailedRequest(d.request_text)) return 'emailed'
  if (d.request_text === SAVED_REQUEST_TEXT) return 'saved'
  if (d.trigger === 'request') return 'asked'
  return 'for_you'
}

/** One outfit as it went into the email. */
export interface EmailedWay {
  styled_way_id: string
  hero_item_id: string
  items: LookItem[]
  why: string | null
  image_url: string | null
}

export interface KeptEmail {
  deliveryId: string
  /** styled_way_id → the look that now holds it. */
  lookByWay: Map<string, string>
}

/**
 * Write the outfits of one email as her looks: one delivery, one look per
 * outfit, visible to her at once. Returns null when nothing could be kept —
 * the email then falls back to its old links rather than not going.
 */
export async function keepEmailedLooks(admin: any, memberId: string, label: string, ways: EmailedWay[]): Promise<KeptEmail | null> {
  const outfits = ways.filter((w) => (w.items ?? []).length >= 2)
  if (!outfits.length) return null
  const now = new Date().toISOString()
  const { data: delivery, error } = await admin.from('pilot_delivery').insert({
    member_id: memberId,
    // MYRA's own initiative, not her ask — so it never shows as an ask still waiting.
    trigger: 'anticipation',
    request_text: `${EMAILED_PREFIX} · ${label}`,
    occasion: null,
    status: 'sent',
    sent_at: now,
  }).select('delivery_id').single()
  if (error || !delivery) { console.error('[emailed-looks] delivery', error?.message); return null }

  const rows = outfits.map((w, i) => ({
    delivery_id: delivery.delivery_id,
    position: i + 1,
    items: w.items,
    notes: w.why || null,
    image_url: w.image_url || null,
    approved_at: now,
    visible_to_client: true,
    published_at: now,
  }))
  const { data: looks, error: lerr } = await admin.from('pilot_look').insert(rows).select('look_id, position')
  if (lerr || !looks?.length) {
    console.error('[emailed-looks] looks', lerr?.message)
    await admin.from('pilot_delivery').delete().eq('delivery_id', delivery.delivery_id)
    return null
  }
  const lookByWay = new Map<string, string>()
  for (const l of looks as { look_id: string; position: number }[]) {
    const w = outfits[l.position - 1]
    if (w) lookByWay.set(w.styled_way_id, l.look_id)
  }
  return { deliveryId: delivery.delivery_id, lookByWay }
}

/** The email did not go: take its looks back out of her Looks. */
export async function forgetEmailedLooks(admin: any, deliveryId: string): Promise<void> {
  await admin.from('pilot_look').delete().eq('delivery_id', deliveryId)
  await admin.from('pilot_delivery').delete().eq('delivery_id', deliveryId)
}
