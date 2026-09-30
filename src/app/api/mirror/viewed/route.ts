import { NextRequest } from 'next/server'
import { memberFromRequest } from '@/lib/mirror/auth'
import { mirrorJson, mirrorOptions } from '@/lib/mirror/cors'
import { productFrom } from '@/lib/mirror/product'
import { ensureMirrorItem } from '@/lib/mirror/style'
import { createAdminClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// POST { product, dwell_ms } — a piece she stayed on; { host, query } — what
// she typed into a shop's search. Neither asks anything of her: FOR YOU reads
// them so it can carry on from where she was. Migration 0072.
export async function OPTIONS() { return mirrorOptions() }

const hostOf = (url: string) => { try { return new URL(url).host.replace(/^www\./, '') } catch { return null } }

/**
 * A search is only a style brief when it was typed at a shop. The extension
 * already declines to send searches typed at a search engine (content.js keeps
 * the same list), but the client is not the boundary — this is. Anything on
 * this list that arrives anyway is acknowledged and thrown away.
 */
const SEARCH_ENGINE = /(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com|search\.(yahoo|aol)\.[a-z.]+|yandex\.[a-z.]+|ecosia\.org|baidu\.com|qwant\.com|startpage\.com|brave\.com|perplexity\.ai|chatgpt\.com|openai\.com|claude\.ai|reddit\.com|pinterest\.[a-z.]+|youtube\.com|instagram\.com|tiktok\.com|facebook\.com)$/i

export async function POST(req: NextRequest) {
  const member = await memberFromRequest(req)
  if (!member) return mirrorJson({ error: 'not connected' }, { status: 401 })
  let b: any
  try { b = await req.json() } catch { return mirrorJson({ error: 'bad json' }, { status: 400 }) }
  const admin = createAdminClient() as any

  const query = typeof b?.query === 'string' ? b.query.trim().slice(0, 80) : ''
  if (query.length >= 3) {
    const host = String(b?.host ?? '').toLowerCase().replace(/^www\./, '').slice(0, 200) || 'unknown'
    if (SEARCH_ENGINE.test(host)) return mirrorJson({ ok: true, noted: 'ignored' })
    const now = new Date().toISOString()
    const { data: prev } = await admin.from('mirror_search').select('times_searched').eq('member_id', member.member_id).eq('host', host).eq('query', query).maybeSingle()
    const { error } = prev
      ? await admin.from('mirror_search').update({ times_searched: (prev.times_searched ?? 1) + 1, last_searched_at: now }).eq('member_id', member.member_id).eq('host', host).eq('query', query)
      : await admin.from('mirror_search').insert({ member_id: member.member_id, host, query, first_searched_at: now, last_searched_at: now })
    if (error && !/mirror_search/.test(error.message)) return mirrorJson({ error: error.message }, { status: 500 })
    return mirrorJson({ ok: true, noted: 'search' })
  }

  const product = productFrom(b?.product)
  if (!product) return mirrorJson({ error: 'product.url and product.title, or query, required' }, { status: 400 })
  // No image scoring here — a view must cost nothing. The first style scores it.
  const ensured = await ensureMirrorItem(product, member, admin, { score: false })
  if (!ensured.item) return mirrorJson({ ok: false, skipped: ensured.error ?? 'not a piece' })
  const itemId = ensured.item.item_id
  const dwell = Math.max(0, Math.min(10 * 60_000, Number(b?.dwell_ms) || 0))
  const now = new Date().toISOString()
  const { data: prev } = await admin.from('recently_viewed').select('dwell_ms, views').eq('member_id', member.member_id).eq('item_id', itemId).maybeSingle()
  const row = { member_id: member.member_id, item_id: itemId, host: hostOf(product.url), viewed_at: now, dwell_ms: (prev?.dwell_ms ?? 0) + dwell, views: (prev?.views ?? 0) + 1 }
  let { error } = await admin.from('recently_viewed').upsert(row, { onConflict: 'member_id,item_id' })
  // Pre-0072: the table exists (0060) but not the two counters.
  if (error && /dwell_ms|views/.test(error.message)) {
    ;({ error } = await admin.from('recently_viewed').upsert({ member_id: row.member_id, item_id: row.item_id, host: row.host, viewed_at: now }, { onConflict: 'member_id,item_id' }))
  }
  if (error) return mirrorJson({ error: error.message }, { status: 500 })
  return mirrorJson({ ok: true, noted: 'view', item_id: itemId })
}
