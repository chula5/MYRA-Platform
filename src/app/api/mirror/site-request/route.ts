import { NextRequest } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { memberFromRequest, type MirrorMember } from '@/lib/mirror/auth'
import { mirrorJson, mirrorOptions } from '@/lib/mirror/cors'
import { createAdminClient } from '@/lib/supabase-server'
import { normaliseBaseUrl } from '@/lib/brand-watch'
import { handleSiteRequest, siteRequestMessage } from '@/lib/brand-onboarding'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // the catalogue read runs after the answer, on this function

// POST { host, url, title, reason } — "add this shop to MYRA" (reason 'add'),
// or "MYRA cannot read this shop; learn it?" ('unsupported' | 'no_grid').
// One row per member and host. Chloe's own ask goes straight on the watchlist;
// anyone else's is judged by MYRA in the background (brand-onboarding.ts).
// GET ?host= — where that shop stands, in plain words for the Mirror.
export async function OPTIONS() { return mirrorOptions() }

const cleanHost = (raw: unknown) => String(raw ?? '').toLowerCase().replace(/^www\./, '').slice(0, 200)
const HOST_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/

/** Chloe on her own Mirror, or shopping as a member in stylist mode. */
const isChloe = (m: MirrorMember) =>
  m.actingAdmin || (!!process.env.ADMIN_USER_ID && m.auth_user_id === process.env.ADMIN_USER_ID)

async function watchedNameFor(admin: any, host: string): Promise<string | null> {
  const base = normaliseBaseUrl(`https://${host}`)
  if (!base) return null
  const { data } = await admin.from('watched_brand').select('name').eq('base_url', base).maybeSingle()
  return data?.name ?? null
}

export async function GET(req: NextRequest) {
  const member = await memberFromRequest(req)
  if (!member) return mirrorJson({ error: 'not connected' }, { status: 401 })
  const host = cleanHost(req.nextUrl.searchParams.get('host'))
  if (!HOST_RE.test(host)) return mirrorJson({ error: 'host required' }, { status: 400 })
  const admin = createAdminClient() as any
  const [{ data: row }, watched] = await Promise.all([
    admin.from('mirror_site_request').select('status, verdict, verdict_note, times_asked')
      .eq('member_id', member.member_id).eq('host', host).maybeSingle(),
    watchedNameFor(admin, host),
  ])
  return mirrorJson({
    ok: true,
    watching: !!watched,
    brand: watched,
    status: watched ? 'watching' : (row?.status ?? null),
    verdict: row?.verdict ?? null,
    note: row?.verdict_note ?? null,
    message: siteRequestMessage(row, watched),
  })
}

export async function POST(req: NextRequest) {
  const member = await memberFromRequest(req)
  if (!member) return mirrorJson({ error: 'not connected' }, { status: 401 })
  let b: any
  try { b = await req.json() } catch { return mirrorJson({ error: 'bad json' }, { status: 400 }) }
  const host = cleanHost(b?.host)
  if (!HOST_RE.test(host)) return mirrorJson({ error: 'host required' }, { status: 400 })
  const byAdmin = isChloe(member)
  const reason = b?.reason === 'no_grid' ? 'no_grid' : b?.reason === 'add' ? 'add' : 'unsupported'

  const admin = createAdminClient() as any
  const watched = await watchedNameFor(admin, host)
  if (watched) return mirrorJson({ ok: true, status: 'watching', watching: true, brand: watched, message: siteRequestMessage(null, watched) })

  const now = new Date().toISOString()
  const fields = {
    url: typeof b?.url === 'string' ? b.url.slice(0, 500) : null,
    page_title: typeof b?.title === 'string' ? b.title.slice(0, 200) : null,
    reason,
    last_asked_at: now,
  }
  const { data: existing } = await admin.from('mirror_site_request')
    .select('request_id, times_asked, status, verdict, verdict_note').eq('member_id', member.member_id).eq('host', host).maybeSingle()

  let requestId: string
  if (existing) {
    requestId = existing.request_id
    // MYRA already said no, and this is not Chloe: the answer stands.
    if (existing.status === 'declined' && !byAdmin) {
      await admin.from('mirror_site_request').update({ times_asked: (existing.times_asked ?? 1) + 1, ...fields }).eq('request_id', requestId)
      return mirrorJson({ ok: true, again: true, status: 'declined', verdict: existing.verdict, note: existing.verdict_note, message: siteRequestMessage(existing, null) })
    }
    if (existing.status === 'assessing') {
      return mirrorJson({ ok: true, again: true, status: 'assessing', message: siteRequestMessage(existing, null) })
    }
    await admin.from('mirror_site_request')
      .update({ times_asked: (existing.times_asked ?? 1) + 1, ...fields, ...(byAdmin ? { requested_by_admin: true } : {}) })
      .eq('request_id', requestId)
  } else {
    const { data: created, error } = await admin.from('mirror_site_request')
      .insert({ member_id: member.member_id, host, ...fields, ...(byAdmin ? { requested_by_admin: true } : {}) })
      .select('request_id').single()
    if (error || !created) {
      return mirrorJson({ error: /mirror_site_request/.test(error?.message ?? '') ? 'MYRA has not been set up for shop requests yet' : (error?.message ?? 'Could not save the request') }, { status: 500 })
    }
    requestId = created.request_id
  }

  // Judged after the answer. Pre-0071 the status check has no 'assessing';
  // the row simply stays 'open' while MYRA reads.
  await admin.from('mirror_site_request').update({ status: 'assessing' }).eq('request_id', requestId)
  const work = handleSiteRequest(requestId, { byAdmin }).catch(async (e) => {
    await admin.from('mirror_site_request')
      .update({ status: 'open', verdict: 'unreadable', verdict_note: e instanceof Error ? e.message : String(e), assessed_at: new Date().toISOString() })
      .eq('request_id', requestId)
  })
  try { waitUntil(work) } catch { /* local dev: the promise simply runs */ }

  return mirrorJson({
    ok: true,
    status: 'assessing',
    message: byAdmin ? 'Adding it to MYRA now — the full scan is starting.' : 'MYRA is reading the shop…',
  })
}
