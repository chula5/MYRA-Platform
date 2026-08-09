// Studio health check — one place to see whether the email sender, the stock
// sentinel and the render queue are actually working. Admin-gated (same rule
// as /admin and /studio/review).
//
//   GET /api/studio/status
//
// Reports what IS, not what should be: whether the Resend key is present, when
// emails actually went out, when items were last stock-checked, and what the
// render queue is doing. Every section degrades to an `error` string rather
// than failing the whole response, so a missing table shows up as a missing
// table instead of a 500.

import { NextResponse } from 'next/server'
import { createServerClient, createAdminClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

async function countOf(
  table: string,
  build: (q: any) => any = (q) => q,
): Promise<number | string> {
  try {
    const admin = createAdminClient()
    const { count, error } = await build(
      admin.from(table as any).select('*', { count: 'exact', head: true }),
    )
    if (error) return `error: ${error.message}`
    return count ?? 0
  } catch (err) {
    return `error: ${err instanceof Error ? err.message : 'failed'}`
  }
}

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.id !== process.env.ADMIN_USER_ID) {
    return new NextResponse('Not found', { status: 404 })
  }

  const admin = createAdminClient()
  const now = Date.now()
  const dayAgo = new Date(now - 86_400_000).toISOString()

  // ── Email ────────────────────────────────────────────────────────────────
  let email: Record<string, unknown>
  try {
    const { data: recent, error } = await admin
      .from('email_log' as any)
      .select('kind, subject, sent_at')
      .order('sent_at', { ascending: false })
      .limit(5)
    email = {
      resendKeyConfigured: !!process.env.RESEND_API_KEY,
      from: process.env.STUDIO_EMAIL_FROM ?? 'MYRA Studio <studio@myraassistant.co.uk> (default)',
      to: process.env.STUDIO_EMAIL_TO ?? 'chloe@myraassistant.co.uk (default)',
      siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? 'https://myraassistant.co.uk (default)',
      ...(error
        ? { logError: error.message }
        : {
            totalSent: (recent ?? []).length,
            recent: (recent ?? []).map((r: any) => ({ kind: r.kind, subject: r.subject, sent_at: r.sent_at })),
          }),
    }
    if (!process.env.RESEND_API_KEY) {
      email.verdict = 'NOT WORKING — RESEND_API_KEY is not set in this environment; emails are skipped.'
    } else if ((recent ?? []).length === 0) {
      email.verdict = 'KEY PRESENT — but nothing has sent yet. Trigger /api/cron/review-digest to test.'
    } else {
      email.verdict = 'WORKING — emails have been sent.'
    }
  } catch (err) {
    email = { error: err instanceof Error ? err.message : 'failed' }
  }

  // ── Stock sentinel ───────────────────────────────────────────────────────
  let stock: Record<string, unknown>
  try {
    const { data: freshest } = await admin
      .from('item' as any)
      .select('stock_checked_at')
      .not('stock_checked_at', 'is', null)
      .order('stock_checked_at', { ascending: false })
      .limit(1)
    const lastCheck = ((freshest ?? []) as any[])[0]?.stock_checked_at ?? null

    stock = {
      lastCheckedAt: lastCheck,
      hoursSinceLastCheck: lastCheck
        ? Math.round(((now - new Date(lastCheck).getTime()) / 3_600_000) * 10) / 10
        : null,
      checkedInLast24h: await countOf('item', (q) => q.gte('stock_checked_at', dayAgo)),
      neverChecked: await countOf('item', (q) =>
        q.eq('status', 'live').is('stock_checked_at', null),
      ),
      itemsOutOfStock: await countOf('item', (q) => q.eq('status', 'out_of_stock')),
      itemsFlaggedOos: await countOf('item', (q) => q.eq('stock_status', 'out_of_stock')),
      outfitsPaused: await countOf('outfit', (q) => q.eq('status', 'paused')),
      autoSwapsTotal: await countOf('stock_swap', (q) => q.eq('mode', 'auto')),
      auditEntries24h: await countOf('audit_log', (q) => q.gte('created_at', dayAgo)),
    }
    const checked24 = stock.checkedInLast24h
    stock.verdict =
      typeof checked24 === 'number' && checked24 > 0
        ? 'RUNNING — items were stock-checked in the last 24h.'
        : lastCheck
          ? 'STALE — no checks in the last 24h. Run ⟳ STOCK in /studio/review or hit /api/cron/stock-sentinel.'
          : 'NEVER RUN — no item has a stock_checked_at timestamp yet.'
  } catch (err) {
    stock = { error: err instanceof Error ? err.message : 'failed' }
  }

  // ── Render queue ─────────────────────────────────────────────────────────
  let renders: Record<string, unknown>
  try {
    const { data: recentFailures } = await admin
      .from('render_job' as any)
      .select('outfit_id, trigger, attempts, error, finished_at')
      .eq('status', 'failed')
      .order('finished_at', { ascending: false })
      .limit(5)
    renders = {
      queued: await countOf('render_job', (q) => q.eq('status', 'queued')),
      running: await countOf('render_job', (q) => q.eq('status', 'running')),
      done: await countOf('render_job', (q) => q.eq('status', 'done')),
      failed: await countOf('render_job', (q) => q.eq('status', 'failed')),
      outfitsAwaitingRender: await countOf('outfit', (q) => q.eq('status', 'approved_rendering')),
      outfitsRenderFailed: await countOf('outfit', (q) => q.eq('status', 'render_failed')),
      recentFailures: (recentFailures ?? []).map((r: any) => ({
        outfit_id: r.outfit_id,
        trigger: r.trigger,
        attempts: r.attempts,
        error: String(r.error ?? '').slice(0, 200),
        finished_at: r.finished_at,
      })),
    }
  } catch (err) {
    renders = { error: err instanceof Error ? err.message : 'failed' }
  }

  // ── Review queue ─────────────────────────────────────────────────────────
  const queue = {
    pendingReview: await countOf('outfit', (q) => q.in('status', ['draft', 'in_review'])),
    needsDesktop: await countOf('outfit', (q) => q.eq('status', 'needs_desktop')),
    live: await countOf('outfit', (q) => q.eq('status', 'live')),
  }

  // ── Migration reachability ───────────────────────────────────────────────
  const migration = {
    render_job: typeof (await countOf('render_job')) === 'number',
    audit_log: typeof (await countOf('audit_log')) === 'number',
    stock_swap: typeof (await countOf('stock_swap')) === 'number',
    email_log: typeof (await countOf('email_log')) === 'number',
  }

  return NextResponse.json(
    { checkedAt: new Date().toISOString(), migration, email, stock, renders, queue },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
