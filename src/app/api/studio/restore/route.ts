// "Back in stock — restore original?" link from the stock email. Reverts the
// swap so the original item returns to the outfit, and queues the mandatory
// Higgsfield re-render — the outfit republishes when the render lands.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { recomputeOutfit } from '@/lib/studio/outfit-recompute'
import { enqueueRender, processRenderQueue } from '@/lib/studio/render-queue'
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
  if (!token) return page('MISSING TOKEN', 'This restore link is incomplete.')

  const admin = createAdminClient()
  const { data: swap } = await admin
    .from('stock_swap' as any)
    .select('*')
    .eq('undo_token', token)
    .maybeSingle()
  if (!swap) return page('LINK NOT RECOGNISED', 'This restore link doesn’t match any swap.')
  if ((swap as any).undone) return page('ALREADY RESTORED', 'This swap was already reversed.')

  const s = swap as any

  // The original must actually be purchasable again.
  const { data: original } = await admin
    .from('item' as any)
    .select('status, stock_status, product_name')
    .eq('item_id', s.out_item_id)
    .maybeSingle()
  const o = original as any
  if (!o || o.status === 'out_of_stock' || o.status === 'archived' || o.stock_status === 'out_of_stock') {
    return page('NOT AVAILABLE', 'The original item isn’t back in stock any more — keeping the replacement.')
  }

  const { data: link } = await admin
    .from('outfit_item' as any)
    .select('outfit_item_id')
    .eq('outfit_id', s.outfit_id)
    .eq('item_id', s.in_item_id)
    .limit(1)
  const row = ((link ?? []) as any[])[0]
  if (!row) return page('NOTHING TO RESTORE', 'The outfit no longer contains the replacement item.')

  await (admin.from('outfit_item') as any)
    .update({ item_id: s.out_item_id })
    .eq('outfit_item_id', row.outfit_item_id)
  await (admin.from('stock_swap') as any).update({ undone: true }).eq('swap_id', s.swap_id)

  // Approved outfit changed → off publish until the fresh render lands.
  await (admin.from('outfit') as any)
    .update({ status: 'approved_rendering' })
    .eq('outfit_id', s.outfit_id)
    .in('status', ['live', 'paused', 'render_failed'])

  await recomputeOutfit(s.outfit_id)
  await writeAudit({
    action: 'restock_restore', entity: 'outfit', entityId: s.outfit_id,
    trigger: 'email_link',
    before: { item: s.in_item_id }, after: { item: s.out_item_id },
  })
  await enqueueRender(s.outfit_id, 'restock_restore')
  void processRenderQueue().catch(() => {})

  return page('ORIGINAL RESTORED', `${o.product_name ?? 'The original piece'} is back in the outfit. A fresh render is queued — it republishes automatically when the image lands.`)
}
