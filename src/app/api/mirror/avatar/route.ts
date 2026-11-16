import { NextRequest } from 'next/server'
import { memberFromRequest } from '@/lib/mirror/auth'
import { mirrorJson, mirrorOptions } from '@/lib/mirror/cors'
import { productFrom } from '@/lib/mirror/product'
import { ensureMirrorItem } from '@/lib/mirror/style'
import { tryOnPiece, tryOnLook } from '@/lib/avatar/try-on'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// TRY ON THE AVATAR, from the Mirror.
//
// POST { product, start }            one piece from the page she is on
// POST { item_id, start }            one piece MYRA already knows (a piece in a look)
// POST { items: [item_id…], start }  a whole look
//   → { state: no_avatar | unwearable | idle | making | ready | failed, image_url?, done?, total?, message? }
//
// `start: true` is her tap: it queues the pictures. Without it the call only
// reports what exists, which is what a hover and the polling use — a hover
// never spends anything.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function OPTIONS() { return mirrorOptions() }

export async function POST(req: NextRequest) {
  const member = await memberFromRequest(req)
  if (!member) return mirrorJson({ error: 'not connected' }, { status: 401 })
  let b: any
  try { b = await req.json() } catch { return mirrorJson({ error: 'bad json' }, { status: 400 }) }
  const start = b?.start === true
  try {
    if (Array.isArray(b?.items)) {
      const ids = b.items.filter((id: unknown): id is string => typeof id === 'string' && UUID.test(id))
      return mirrorJson(await tryOnLook(member.member_id, ids, { start }))
    }
    if (typeof b?.item_id === 'string' && UUID.test(b.item_id)) {
      return mirrorJson(await tryOnPiece(member.member_id, b.item_id, { start }))
    }
    const product = productFrom(b?.product)
    if (!product) return mirrorJson({ error: 'product, item_id or items required' }, { status: 400 })
    // The piece becomes a row MYRA can dress her in; its scoring can wait for a styling ask.
    const ensured = await ensureMirrorItem(product, member, undefined, { score: false })
    if (!ensured.item) return mirrorJson({ state: 'failed', message: ensured.error ?? 'Could not read this piece' })
    return mirrorJson({ ...(await tryOnPiece(member.member_id, ensured.item.item_id, { start })), item_id: ensured.item.item_id })
  } catch (e) {
    console.error('[mirror] avatar', e)
    return mirrorJson({ state: 'failed', message: 'That did not work — try again' })
  }
}
