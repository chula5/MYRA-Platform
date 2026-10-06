import { NextRequest } from 'next/server'
import { memberFromRequest } from '@/lib/mirror/auth'
import { mirrorJson, mirrorOptions } from '@/lib/mirror/cors'
import { createAdminClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

// POST { watchedBrandId, seen, queued, pages, done, error? }
//
// The extension, scanning a mirror-fed brand in her Chrome, reports what it
// has read so far so the Brand Watch card can show the scan as it runs —
// the same card line a Shopify scan writes. Only a brand on the mirror route
// takes a report: the others are scanned by a server and report themselves.
// The pieces themselves never come through here; they arrive with each
// ranked page (/api/mirror/rank → queueMirrorProducts).

export async function OPTIONS() { return mirrorOptions() }

export async function POST(req: NextRequest) {
  const member = await memberFromRequest(req)
  if (!member) return mirrorJson({ error: 'not connected' }, { status: 401 })
  let b: any
  try { b = await req.json() } catch { return mirrorJson({ error: 'bad json' }, { status: 400 }) }
  const id = typeof b?.watchedBrandId === 'string' && /^[0-9a-f-]{36}$/i.test(b.watchedBrandId) ? b.watchedBrandId : null
  if (!id) return mirrorJson({ error: 'watchedBrandId required' }, { status: 400 })
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(Math.round(v), 100000) : 0)
  const seen = n(b.seen), queued = n(b.queued), pages = Math.max(1, n(b.pages))
  const done = b.done === true
  const error = typeof b.error === 'string' ? b.error.slice(0, 200) : null

  const admin = createAdminClient() as any
  const { data: w } = await admin.from('watched_brand').select('watched_brand_id, platform, scan_state').eq('watched_brand_id', id).maybeSingle()
  if (!w) return mirrorJson({ error: 'not on the watchlist' }, { status: 404 })
  if (w.platform !== 'mirror') return mirrorJson({ error: 'not a mirror-fed brand' }, { status: 400 })

  const prev = (w.scan_state ?? {}) as Record<string, unknown>
  const now = new Date().toISOString()
  const scan_state = {
    ...prev,
    mode: 'mirror',
    running: !done,
    started_at: typeof prev.started_at === 'string' && prev.running ? prev.started_at : (prev.started_at ?? now),
    done: pages, total: null, seen, queued,
    ...(done ? { finished_at: now } : {}),
    ...(error ? { error } : {}),
  }
  const patch: Record<string, unknown> = { scan_state }
  if (done) { patch.last_checked_at = now; patch.last_new_count = queued }
  const { error: upErr } = await admin.from('watched_brand').update(patch).eq('watched_brand_id', id)
  if (upErr) return mirrorJson({ error: upErr.message }, { status: 500 })
  return mirrorJson({ ok: true, running: !done })
}
