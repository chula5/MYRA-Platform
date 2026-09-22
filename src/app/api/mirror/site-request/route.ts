import { NextRequest } from 'next/server'
import { memberFromRequest } from '@/lib/mirror/auth'
import { mirrorJson, mirrorOptions } from '@/lib/mirror/cors'
import { createAdminClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

// POST { host, url, title, reason } — "MYRA cannot read this shop; learn it?"
// One row per member and host; asking again only bumps the count, so pressing
// it twice never becomes two jobs for Chloe.
export async function OPTIONS() { return mirrorOptions() }

export async function POST(req: NextRequest) {
  const member = await memberFromRequest(req)
  if (!member) return mirrorJson({ error: 'not connected' }, { status: 401 })
  let b: any
  try { b = await req.json() } catch { return mirrorJson({ error: 'bad json' }, { status: 400 }) }
  const host = String(b?.host ?? '').toLowerCase().replace(/^www\./, '').slice(0, 200)
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) return mirrorJson({ error: 'host required' }, { status: 400 })

  const admin = createAdminClient() as any
  const row = {
    member_id: member.member_id,
    host,
    url: typeof b?.url === 'string' ? b.url.slice(0, 500) : null,
    page_title: typeof b?.title === 'string' ? b.title.slice(0, 200) : null,
    reason: b?.reason === 'no_grid' ? 'no_grid' : 'unsupported',
    last_asked_at: new Date().toISOString(),
  }
  const { data: existing } = await admin.from('mirror_site_request')
    .select('request_id, times_asked, status').eq('member_id', member.member_id).eq('host', host).maybeSingle()
  if (existing) {
    await admin.from('mirror_site_request')
      .update({ times_asked: (existing.times_asked ?? 1) + 1, last_asked_at: row.last_asked_at, url: row.url, page_title: row.page_title })
      .eq('request_id', existing.request_id)
    return mirrorJson({ ok: true, again: true, status: existing.status })
  }
  const { error } = await admin.from('mirror_site_request').insert(row)
  if (error) {
    return mirrorJson({ error: /mirror_site_request/.test(error.message) ? 'MYRA has not been set up for shop requests yet' : error.message }, { status: 500 })
  }
  return mirrorJson({ ok: true })
}
