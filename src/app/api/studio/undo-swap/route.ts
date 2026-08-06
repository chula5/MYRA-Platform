// UNDO link from the stock email. Reverses an auto-swap: the outfit goes back
// to paused with the original (out-of-stock) item, the swap is marked undone,
// any pending render for it is cancelled, and the outfit enters the review
// queue as a restock card. Authenticated by the unguessable one-time token.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { recomputeOutfit } from '@/lib/studio/outfit-recompute'
import { writeAudit } from '@/lib/studio/audit'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function page(title: string, body: string): NextResponse {
  return new NextResponse(
    `<!doctype html><html><body style="font-family:Helvetica,Arial,sans-serif;background:#f2f2f2;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;">
     <div style="background:#fff;border:1px solid #e2e0db;border-radius:12px;padding:36px 44px;text-align:center;max-width:420px;">
       <p style="font-size:13px;letter-spacing:0.14em;color:#4a4e57;margin:0 0 14px 0;">MYRA</p>
       <p style="font-size:15px;letter-spacing:0.05em;color:#0a0a0a;margin:0 0 8px 0;">${title}</p>
       <p style="font-size:12px;color:#6b6b6b;line-height:1.6;margin:0;">${body}</p>
     </div></body></html>`,
    { headers: { 'Content-Type': 'text/html' } },
  )
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (!token) return page('MISSING TOKEN', 'This undo link is incomplete.')

  const admin = createAdminClient()
  const { data: swap } = await admin
    .from('stock_swap' as any)
    .select('*')
    .eq('undo_token', token)
    .maybeSingle()
  if (!swap) return page('LINK NOT RECOGNISED', 'This undo link doesn’t match any swap.')
  if ((swap as any).undone) return page('ALREADY UNDONE', 'This swap was already reversed.')

  const s = swap as any

  // Reverse the join row (whichever row currently holds the replacement).
  const { data: link } = await admin
    .from('outfit_item' as any)
    .select('outfit_item_id')
    .eq('outfit_id', s.outfit_id)
    .eq('item_id', s.in_item_id)
    .limit(1)
  const row = ((link ?? []) as any[])[0]
  if (!row) return page('NOTHING TO UNDO', 'The outfit no longer contains the swapped-in item.')

  await (admin.from('outfit_item') as any)
    .update({ item_id: s.out_item_id })
    .eq('outfit_item_id', row.outfit_item_id)

  // Outfit back to paused → restock card in the review queue.
  await (admin.from('outfit') as any)
    .update({ status: 'paused', paused_reason: `item_out_of_stock:${s.out_item_id}` })
    .eq('outfit_id', s.outfit_id)

  // Cancel any pending render for this outfit (it would render the undone set).
  await (admin.from('render_job') as any)
    .update({ status: 'failed', error: 'superseded by undo', finished_at: new Date().toISOString() })
    .eq('outfit_id', s.outfit_id)
    .eq('status', 'queued')

  await (admin.from('stock_swap') as any).update({ undone: true }).eq('swap_id', s.swap_id)

  await recomputeOutfit(s.outfit_id, { dimItemId: s.out_item_id })
  await writeAudit({
    action: 'undo_swap', entity: 'outfit', entityId: s.outfit_id,
    trigger: 'email_link',
    before: { item: s.in_item_id, status: 'live' },
    after: { item: s.out_item_id, status: 'paused' },
  })

  return page('SWAP UNDONE', 'The outfit is paused and waiting in your review queue for a replacement pick.')
}
