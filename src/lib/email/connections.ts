// A client's connected inboxes, their scans, and what was found in them.
//
// A plain server module: every caller has already resolved WHICH member is
// asking (lib/client-member for her pages and HER VIEW, the cron for scans), and
// every function here is scoped by that member id. Secrets never leave this
// module in plain text.
//
// A scan is a queued job that runs in chunks under the cron's time limit and
// resumes where it stopped: phase 'list' asks the inbox for order-looking
// messages since the scan date; phase 'read' pre-filters each subject, sends
// the rest to extraction, and records each wearable piece once.

import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import { analyseProductImage } from '@/app/admin/items/analyse-image'
import { persistImageToCloudinary } from '@/lib/cloudinary-persist'
import { productPageImage } from '@/lib/product-image'
import { insertItemTolerantly, resolveBrandId } from '@/lib/wardrobe/store'
import { buildOwnedItemFromProduct, lowConfidenceDims } from '@/lib/wardrobe/approve'
import { encryptSecret, decryptSecret } from './secrets'
import { googleAccessToken, listGmailPurchaseIds, getGmailMessage, revokeGoogle } from './gmail'
import { listImapPurchaseUids, fetchImapMessages, testImapLogin, type ImapConfig } from './imap'
import { findKey, looksLikeOrderEmail, type MailMessage } from './purchase-core'
import { extractPurchase } from './purchases'

const db = () => createAdminClient() as any

const READ_CHUNK = 10
const STALE_MS = 10 * 60 * 1000

export interface EmailConnectionView {
  connection_id: string
  provider: 'gmail' | 'imap'
  email: string
  status: string
  error: string | null
  last_scanned_at: string | null
  scan: { status: string; phase: string; total: number; read: number; found: number; error: string | null } | null
}

export interface EmailFindView {
  find_id: string
  retailer: string | null
  order_date: string | null
  product_name: string
  brand_name: string | null
  colour: string | null
  size: string | null
  price: number | null
  currency: string | null
  image_url: string | null
  product_url: string | null
  status: string
  error: string | null
}

// ── Connections ─────────────────────────────────────────────────────────────

export async function saveConnection(
  memberId: string,
  provider: 'gmail' | 'imap',
  email: string,
  secret: string,
  imapHost: string | null = null,
): Promise<{ connectionId?: string; error?: string }> {
  const { data, error } = await db().from('member_email_connection').upsert({
    member_id: memberId,
    provider,
    email: email.trim().toLowerCase(),
    imap_host: imapHost,
    secret_enc: encryptSecret(secret),
    status: 'connected',
    error: null,
  }, { onConflict: 'member_id,provider,email' }).select('connection_id').single()
  if (error || !data) return { error: error?.message ?? 'Could not save the connection' }
  await queueScan(memberId, data.connection_id)
  return { connectionId: data.connection_id }
}

/** Test an IMAP login, then save it and start the first scan. */
export async function connectImap(memberId: string, cfg: ImapConfig): Promise<{ connectionId?: string; error?: string }> {
  const test = await testImapLogin(cfg)
  if (!test.ok) return { error: test.error }
  return saveConnection(memberId, 'imap', cfg.email, cfg.password, cfg.host)
}

export async function queueScan(memberId: string, connectionId: string): Promise<{ error?: string }> {
  const a = db()
  const { data: busy } = await a.from('email_scan_job').select('job_id')
    .eq('connection_id', connectionId).in('status', ['queued', 'running']).limit(1)
  if ((busy ?? []).length) return {}
  const { error } = await a.from('email_scan_job').insert({ connection_id: connectionId, member_id: memberId })
  return error ? { error: error.message } : {}
}

export async function disconnect(memberId: string, connectionId: string): Promise<{ error?: string }> {
  const a = db()
  const { data: c } = await a.from('member_email_connection').select('*')
    .eq('connection_id', connectionId).eq('member_id', memberId).maybeSingle()
  if (!c) return { error: 'Connection not found' }
  if (c.provider === 'gmail') {
    try { await revokeGoogle(decryptSecret(c.secret_enc)) } catch { /* the delete below still removes it */ }
  }
  // Deleting the row deletes the secret; found pieces stay for review.
  const { error } = await a.from('member_email_connection').delete().eq('connection_id', connectionId).eq('member_id', memberId)
  return error ? { error: error.message } : {}
}

export async function listConnections(memberId: string): Promise<EmailConnectionView[]> {
  const a = db()
  const { data: rows } = await a.from('member_email_connection')
    .select('connection_id, provider, email, status, error, last_scanned_at')
    .eq('member_id', memberId).order('created_at')
  const out: EmailConnectionView[] = []
  for (const c of (rows ?? []) as any[]) {
    const { data: jobs } = await a.from('email_scan_job')
      .select('status, phase, message_ids, cursor, found, error')
      .eq('connection_id', c.connection_id).order('created_at', { ascending: false }).limit(1)
    const j = (jobs ?? [])[0]
    out.push({
      ...c,
      scan: j ? { status: j.status, phase: j.phase, total: (j.message_ids ?? []).length, read: j.cursor, found: j.found, error: j.error } : null,
    })
  }
  return out
}

export async function listFinds(memberId: string, status: 'pending' | 'approved' | 'discarded' = 'pending'): Promise<EmailFindView[]> {
  const { data } = await db().from('email_purchase_find')
    .select('find_id, retailer, order_date, product_name, brand_name, colour, size, price, currency, image_url, product_url, status, error')
    .eq('member_id', memberId).eq('status', status)
    .order('order_date', { ascending: false, nullsFirst: false }).limit(300)
  return ((data ?? []) as any[]).map((r) => ({ ...r, price: r.price != null ? Number(r.price) : null }))
}

// ── Scanning ────────────────────────────────────────────────────────────────

async function listCandidateIds(c: any, since: Date): Promise<string[]> {
  const secret = decryptSecret(c.secret_enc)
  if (c.provider === 'gmail') return listGmailPurchaseIds(await googleAccessToken(secret), since)
  return listImapPurchaseUids({ host: c.imap_host, email: c.email, password: secret }, since)
}

async function fetchMessages(c: any, ids: string[]): Promise<MailMessage[]> {
  const secret = decryptSecret(c.secret_enc)
  if (c.provider === 'gmail') {
    const token = await googleAccessToken(secret)
    const out: MailMessage[] = []
    for (const id of ids) out.push(await getGmailMessage(token, id))
    return out
  }
  return fetchImapMessages({ host: c.imap_host, email: c.email, password: secret }, ids)
}

const permanentAuthError = (msg: string) => /invalid_grant|unauthorized|401|403|auth|password|credentials|AUTHENTICATIONFAILED/i.test(msg)

/** Drain queued scans within a time budget. Safe to call from the cron and "scan now". */
export async function processEmailScans(budgetMs = 240_000): Promise<{ read: number; found: number; aiCalls: number; remaining: number }> {
  const a = db()
  const started = Date.now()
  let read = 0
  let found = 0
  let aiCalls = 0

  await a.from('email_scan_job').update({ status: 'queued' })
    .eq('status', 'running').lt('started_at', new Date(Date.now() - STALE_MS).toISOString())

  while (Date.now() - started < budgetMs) {
    const { data: next } = await a.from('email_scan_job').select('*').eq('status', 'queued').order('created_at').limit(1)
    const job = (next ?? [])[0]
    if (!job) break
    const { data: claimed } = await a.from('email_scan_job')
      .update({ status: 'running', started_at: new Date().toISOString(), attempts: job.attempts + 1 })
      .eq('job_id', job.job_id).eq('status', 'queued').select('job_id')
    if (!claimed?.length) continue

    const { data: c } = await a.from('member_email_connection').select('*').eq('connection_id', job.connection_id).maybeSingle()
    if (!c) {
      await a.from('email_scan_job').update({ status: 'failed', error: 'Connection removed', finished_at: new Date().toISOString() }).eq('job_id', job.job_id)
      continue
    }

    try {
      let ids: string[] = job.message_ids ?? []
      let cursor: number = job.cursor ?? 0
      if (job.phase === 'list') {
        // A rescan reads from just before the last scan; the first reads the whole year.
        const since = c.last_scanned_at ? new Date(new Date(c.last_scanned_at).getTime() - 3 * 86_400_000) : new Date(c.scan_from)
        ids = await listCandidateIds(c, since)
        cursor = 0
        await a.from('email_scan_job').update({ phase: 'read', message_ids: ids, cursor }).eq('job_id', job.job_id)
      }

      let jobFound = job.found ?? 0
      let jobCalls = job.ai_calls ?? 0
      while (cursor < ids.length && Date.now() - started < budgetMs) {
        const chunk = ids.slice(cursor, cursor + READ_CHUNK)
        const messages = await fetchMessages(c, chunk)
        for (const m of messages) {
          if (!looksLikeOrderEmail(m)) continue
          const { extraction } = await extractPurchase(m)
          jobCalls++
          aiCalls++
          if (!extraction.is_purchase) continue
          const rows = extraction.items.map((item) => ({
            member_id: job.member_id,
            connection_id: c.connection_id,
            message_id: m.id,
            find_key: findKey(extraction, item),
            retailer: extraction.retailer,
            order_id: extraction.order_id,
            order_date: extraction.order_date,
            product_name: item.product_name,
            brand_name: item.brand_name,
            colour: item.colour,
            size: item.size,
            price: item.price,
            currency: item.currency,
            image_url: item.image_url,
            product_url: item.product_url,
          }))
          if (rows.length) {
            const { data: inserted } = await a.from('email_purchase_find')
              .upsert(rows, { onConflict: 'member_id,find_key', ignoreDuplicates: true }).select('find_id')
            jobFound += (inserted ?? []).length
            found += (inserted ?? []).length
          }
        }
        cursor += chunk.length
        read += chunk.length
        await a.from('email_scan_job').update({ cursor, found: jobFound, ai_calls: jobCalls }).eq('job_id', job.job_id)
      }

      if (cursor >= ids.length) {
        await a.from('email_scan_job').update({ status: 'done', finished_at: new Date().toISOString(), error: null }).eq('job_id', job.job_id)
        await a.from('member_email_connection').update({ last_scanned_at: new Date().toISOString(), status: 'connected', error: null }).eq('connection_id', c.connection_id)
      } else {
        // Out of time — back in the queue, resuming at the cursor.
        await a.from('email_scan_job').update({ status: 'queued' }).eq('job_id', job.job_id)
        break
      }
    } catch (err) {
      const msg = (err instanceof Error ? err.message : 'Scan failed').slice(0, 400)
      const permanent = permanentAuthError(msg) || job.attempts + 1 >= 3
      await a.from('email_scan_job').update(
        permanent ? { status: 'failed', error: msg, finished_at: new Date().toISOString() } : { status: 'queued', error: msg },
      ).eq('job_id', job.job_id)
      if (permanentAuthError(msg)) {
        await a.from('member_email_connection').update({ status: 'error', error: 'The inbox refused MYRA — connect it again.' }).eq('connection_id', c.connection_id)
      }
    }
  }

  const { count } = await a.from('email_scan_job').select('job_id', { count: 'exact', head: true }).in('status', ['queued', 'running'])
  return { read, found, aiCalls, remaining: count ?? 0 }
}

// ── Review ──────────────────────────────────────────────────────────────────

/** Add a found piece to her wardrobe: its product photo, read for type, colour and shape. */
export async function approveFind(memberId: string, findId: string): Promise<{ itemId?: string; error?: string }> {
  const a = db()
  const { data: f } = await a.from('email_purchase_find').select('*')
    .eq('find_id', findId).eq('member_id', memberId).maybeSingle()
  if (!f) return { error: 'Not found' }
  if (f.status === 'approved' && f.item_id) return { itemId: f.item_id }

  // The product page's photo is usually larger and cleaner than the email's.
  const fromPage = f.product_url ? await productPageImage(f.product_url) : null
  const source = fromPage ?? f.image_url
  if (!source) {
    await a.from('email_purchase_find').update({ error: 'No product photo in the email or on the product page' }).eq('find_id', findId)
    return { error: 'No product photo was found for this piece — add it with a photo instead' }
  }
  const hosted = (await persistImageToCloudinary(source, { folder: `wardrobe/email/${memberId.slice(0, 8)}` })) ?? source

  const { data: scores, error: serr } = await analyseProductImage(hosted)
  if (!scores?.item_type) {
    const msg = serr ?? 'Could not tell what kind of piece this is'
    await a.from('email_purchase_find').update({ error: msg }).eq('find_id', findId)
    return { error: msg }
  }

  const brandName = f.brand_name ?? scores.brand_name ?? null
  const brandId = await resolveBrandId(brandName, { create: false })
  const row = buildOwnedItemFromProduct({
    owner: { kind: 'pilot_member', id: memberId },
    brandId,
    brandLabel: brandName ?? f.retailer,
    productName: f.product_name,
    imageUrl: hosted,
    retailerUrl: f.product_url,
    price: f.price != null ? Number(f.price) : null,
    currency: f.currency,
    scores,
    lowConfidence: lowConfidenceDims(scores, { brandKnown: !!brandId }),
    retailer: f.retailer,
    orderDate: f.order_date,
    colour: f.colour,
    size: f.size,
    findId,
  })
  const inserted = await insertItemTolerantly(a, row)
  if (!inserted.itemId) return { error: inserted.error ?? 'Could not add it to the wardrobe' }
  await a.from('email_purchase_find').update({ status: 'approved', item_id: inserted.itemId, error: null }).eq('find_id', findId)
  return { itemId: inserted.itemId }
}

export async function discardFind(memberId: string, findId: string): Promise<{ error?: string }> {
  const { error } = await db().from('email_purchase_find').update({ status: 'discarded' })
    .eq('find_id', findId).eq('member_id', memberId)
  return error ? { error: error.message } : {}
}
