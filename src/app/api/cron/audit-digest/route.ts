// Audit digest — 6pm UK daily (Vercel cron, see vercel.json).
// Stage 2: every auto-published outfit from the last 24h as a grid, each with a
// one-tap KEEP / SWAP / PULL via /admin/audit (admin auth protects the links).
// Stage 3 stylists get a weekly digest instead — daily runs skip them except
// on Mondays.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { listStylists, loadAutonomy } from '@/lib/stylist-store'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://myraassistant.co.uk'

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const admin = createAdminClient()
    const stylists = await listStylists('live')
    const isMonday = new Date().getUTCDay() === 1
    let totalEntries = 0
    let emailed = false

    for (const s of stylists) {
      const autonomy = await loadAutonomy(s.stylist_id)
      if (autonomy.stage < 2) continue
      // Stage 3 → weekly digest (Mondays); Stage 2 → daily.
      const windowHours = autonomy.stage >= 3 ? 24 * 7 : 24
      if (autonomy.stage >= 3 && !isMonday) continue

      const since = new Date(Date.now() - windowHours * 3600000).toISOString()
      const { data: log } = await admin
        .from('auto_publish_log' as any)
        .select('*')
        .eq('stylist_id', s.stylist_id)
        .gte('published_at', since)
        .is('audited_at', null)
        .order('published_at', { ascending: false })
      const rows = (log ?? []) as any[]
      if (!rows.length) continue
      totalEntries += rows.length

      // Email via Resend when configured; the /admin/audit page is always the
      // canonical surface either way.
      const apiKey = process.env.RESEND_API_KEY
      const to = process.env.AUDIT_EMAIL_TO
      if (apiKey && to) {
        const { data: outfits } = await admin
          .from('outfit' as any)
          .select('outfit_id, image_url, aesthetic_label')
          .in('outfit_id', rows.map((r) => r.outfit_id))
        const byId = new Map(((outfits ?? []) as any[]).map((o) => [o.outfit_id, o]))
        const cells = rows
          .map((r) => {
            const o = byId.get(r.outfit_id)
            return `<td style="padding:6px;text-align:center;vertical-align:top">
              <a href="${SITE}/admin/audit"><img src="${o?.image_url ?? ''}" width="140" style="border-radius:8px;display:block"/></a>
              <div style="font:9px sans-serif;letter-spacing:1px;color:#6b6b6b;margin-top:4px">${(o?.aesthetic_label ?? '').toUpperCase()}</div>
              <a href="${SITE}/admin/audit" style="font:10px sans-serif;color:#b83a3a">SWAP / PULL →</a>
            </td>`
          })
          .join('')
        const html = `<div style="font-family:sans-serif">
          <p style="font-size:11px;letter-spacing:2px;color:#c4a882">MYRA · ${s.name.toUpperCase()} · STAGE ${autonomy.stage}</p>
          <h2 style="font-weight:400;letter-spacing:1px">${rows.length} auto-published outfit${rows.length === 1 ? '' : 's'} ${autonomy.stage >= 3 ? 'this week' : 'in the last 24h'}</h2>
          <table><tr>${cells}</tr></table>
          <p style="font-size:11px;color:#6b6b6b">One tap on SWAP or PULL unpublishes the outfit and demotes the autonomy stage.
          <a href="${SITE}/admin/audit">Open the audit →</a></p>
        </div>`
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: process.env.AUDIT_EMAIL_FROM ?? 'MYRA <onboarding@resend.dev>',
            to: [to],
            subject: `MYRA audit — ${rows.length} auto-published (${s.name})`,
            html,
          }),
        })
        emailed = emailed || res.ok
      }
    }
    return NextResponse.json({ ok: true, entries: totalEntries, emailed })
  } catch (err) {
    console.error('[audit-digest]', err)
    return NextResponse.json({ error: 'Digest failed' }, { status: 500 })
  }
}
