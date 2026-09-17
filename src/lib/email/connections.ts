// A client's connected inboxes, their scans, and what was found in them.
//
// A plain server module: every caller has already resolved WHICH member is
// asking (lib/client-member for her pages and HER VIEW, the cron for scans), and
// every function here is scoped by that member id. Secrets never leave this
// module in plain text.
//
// A scan is a queued job that runs in chunks under the cron's time limit and
// resumes where it stopped: phase 'list' asks the inbox for order- and
// return-looking messages since the scan date; phase 'read' pre-filters each
// subject, sends the rest to extraction, and records each wearable piece ONCE —
// the order confirmation, payment receipt, dispatch and delivery emails for one
// piece merge into one find. A return or refund marks the piece returned; one
// read before its order (inboxes are read newest first) waits as a marker.

import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import { analyseProductImage } from '@/app/admin/items/analyse-image'
import { persistImageToCloudinary } from '@/lib/cloudinary-persist'
import { productPageImage } from '@/lib/product-image'
import { deleteOwnedItem, insertItemTolerantly, resolveBrandId } from '@/lib/wardrobe/store'
import { uploadBufferToCloudinary } from '@/lib/wardrobe/cloudinary'
import { detectGarments, editToCutout } from '@/lib/wardrobe/openai'
import { buildCutoutPrompt, cropGarment, cutoutLooksValid, detectorJpeg, frameOnWhite, normalisePhoto } from '@/lib/wardrobe/cutout'
import { openAiConfigured } from '@/lib/wardrobe/config'
import { rebuildLooksWithoutItems } from '@/app/admin/private-stylist/actions'
import { buildOwnedItemFromProduct, lowConfidenceDims } from '@/lib/wardrobe/approve'
import { encryptSecret, decryptSecret } from './secrets'
import { googleAccessToken, listGmailPurchaseIds, getGmailHeaders, getGmailMessage, searchGmailIds, revokeGoogle } from './gmail'
import { listImapPurchaseUids, fetchImapHeaders, fetchImapMessages, searchImapUids, testImapLogin, type ImapConfig } from './imap'
import {
  RETURNED, RETURN_SEEN, RETURN_STARTED, RETURN_STARTED_SEEN, emailForExtraction, findKey, isGenericName, mergeFind, pieceWords,
  sameFind, subjectTopic, worthReading,
  type MailMessage, type PurchaseExtraction, type PurchaseItem,
} from './purchase-core'
import { extractPurchase, namePieceFromPhoto, triageBySubject } from './purchases'

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

/**
 * The emails worth opening, newest first. Every inbox is big, so the body of
 * an email is only opened after three free-or-cheap sieves: the inbox's own
 * search (order and return words), the sender/subject rules, and one bulk
 * AI sort of the remaining subjects (~150 per call).
 */
async function listCandidateIds(c: any, since: Date): Promise<string[]> {
  const secret = decryptSecret(c.secret_enc)
  let ids: string[]
  let headers: { id: string; from: string; subject: string }[]
  if (c.provider === 'gmail') {
    const token = await googleAccessToken(secret)
    ids = await listGmailPurchaseIds(token, since)
    headers = await getGmailHeaders(token, ids)
  } else {
    const cfg = { host: c.imap_host, email: c.email, password: secret }
    ids = await listImapPurchaseUids(cfg, since)
    headers = await fetchImapHeaders(cfg, ids)
  }
  const worth = headers.filter((h) => worthReading(h, c.email))
  return triageIds(ids, worth)
}

async function triageIds(ids: string[], worth: { id: string; from: string; subject: string }[]): Promise<string[]> {
  const keep = await triageBySubject(worth)
  return ids.filter((id) => keep.has(id))
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

      const finds = await loadFindsForMatching(a, job.member_id)
      const topicsRead = new Set<string>()
      let jobFound = job.found ?? 0
      let jobCalls = job.ai_calls ?? 0
      while (cursor < ids.length && Date.now() - started < budgetMs) {
        const chunk = ids.slice(cursor, cursor + READ_CHUNK)
        const messages = await fetchMessages(c, chunk)
        for (const m of messages) {
          if (!worthReading(m, c.email)) continue
          // One read per piece or order: its receipt, delivery and feedback emails say the same.
          const topic = subjectTopic(m)
          if (topic && topicsRead.has(topic)) continue
          if (topic) topicsRead.add(topic)
          const { extraction } = await extractPurchase(m)
          jobCalls++
          aiCalls++
          if (extraction.kind === 'other') continue
          const r = await recordEmail(a, finds, job.member_id, c.connection_id, m.id, extraction)
          jobFound += r.added
          found += r.added
          aiCalls += r.aiCalls
          jobCalls += r.aiCalls
        }
        cursor += chunk.length
        read += chunk.length
        await a.from('email_scan_job').update({ cursor, found: jobFound, ai_calls: jobCalls }).eq('job_id', job.job_id)
      }

      if (cursor >= ids.length) {
        // Pieces whose order email had no picture: look for one in her other emails.
        await huntMissingPhotos(job.member_id).catch(() => 0)
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

// ── Recording what an email says ────────────────────────────────────────────

type FindRow = {
  find_id: string
  retailer: string | null
  order_id: string | null
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
  item_id: string | null
}

const FIND_COLS = 'find_id, retailer, order_id, order_date, product_name, brand_name, colour, size, price, currency, image_url, product_url, status, error, item_id'

/** Every find she has, so a new email can be matched to the piece it is about. */
async function loadFindsForMatching(a: any, memberId: string): Promise<FindRow[]> {
  const out: FindRow[] = []
  for (let from = 0; ; from += 1000) {
    const { data } = await a.from('email_purchase_find').select(FIND_COLS).eq('member_id', memberId).order('created_at').range(from, from + 999)
    out.push(...((data ?? []) as FindRow[]))
    if (!data || data.length < 1000) break
  }
  return out
}

const isReturnMarker = (f: FindRow) => f.status === 'discarded' && (f.error === RETURN_SEEN || f.error === RETURN_STARTED_SEEN)

/**
 * Apply one extracted email to her finds (kept in `finds`, updated in place):
 * a purchase adds a piece or fills in one already found; a return marks the
 * matching pieces returned, or leaves a marker for an order not read yet.
 */
async function recordEmail(
  a: any, finds: FindRow[], memberId: string, connectionId: string, messageId: string, e: PurchaseExtraction,
): Promise<{ added: number; aiCalls: number }> {
  let added = 0
  let aiCalls = 0
  const save = async (f: FindRow, patch: Partial<FindRow>) => {
    if (!Object.keys(patch).length) return
    Object.assign(f, patch)
    await a.from('email_purchase_find').update(patch).eq('find_id', f.find_id)
  }

  if (e.kind === 'return') {
    const targets: FindRow[] = []
    if (e.whole_order && e.order_id) {
      targets.push(...finds.filter((f) => !isReturnMarker(f) && f.order_id && f.order_id.replace(/\W/g, '') === e.order_id!.replace(/\W/g, '')))
    }
    for (const item of e.items) {
      const incoming = { ...item, retailer: e.retailer, order_id: e.order_id, order_date: e.order_date }
      // A return comes after the purchase — allow a longer gap than for duplicates.
      const hits = finds.filter((f) => sameFind(f, incoming, 120))
      if (hits.length) { targets.push(...hits); continue }
      const row = await insertFind(a, finds, memberId, connectionId, messageId, e, item, {
        status: 'discarded', error: e.return_confirmed ? RETURN_SEEN : RETURN_STARTED_SEEN, keyPrefix: 'return|',
      })
      if (row) targets.push(row)
    }
    for (const f of targets) {
      if (isReturnMarker(f)) {
        // A later email finished the return that an earlier one started.
        if (e.return_confirmed && f.error === RETURN_STARTED_SEEN) await save(f, { error: RETURN_SEEN })
        continue
      }
      if (e.return_confirmed) {
        if (f.status === 'pending') await save(f, { status: 'discarded', error: RETURNED })
        else if (f.status === 'approved') await save(f, { error: RETURNED })
      } else if (f.status === 'pending' && f.error !== RETURNED) {
        // Only started: she may keep it, so it stays to review, with a note.
        await save(f, { error: RETURN_STARTED })
      }
    }
    return { added, aiCalls }
  }

  for (let item of e.items) {
    // Emails that never name the piece ("Item") — name it from its photo.
    if (isGenericName(item.product_name) && item.image_url) {
      const named = await namePieceFromPhoto(item.image_url)
      aiCalls++
      if (named) item = { ...item, product_name: named }
    }
    // Still no name and nothing to show — nothing she could recognise.
    if (isGenericName(item.product_name)) continue
    const incoming = { ...item, retailer: e.retailer, order_id: e.order_id, order_date: e.order_date }
    const match = finds.find((f) => sameFind(f, incoming))
    if (match) {
      const patch = mergeFind(match, incoming) as Partial<FindRow>
      // Its return was read first: the piece arrives returned, or with its return started.
      if (isReturnMarker(match)) {
        if (match.error === RETURN_SEEN) patch.error = RETURNED
        else { patch.error = RETURN_STARTED; patch.status = 'pending' }
      }
      await save(match, patch)
      continue
    }
    const row = await insertFind(a, finds, memberId, connectionId, messageId, e, item, { status: 'pending', error: null, keyPrefix: '' })
    if (row) added++
  }
  return { added, aiCalls }
}

async function insertFind(
  a: any, finds: FindRow[], memberId: string, connectionId: string, messageId: string, e: PurchaseExtraction, item: PurchaseItem,
  opts: { status: 'pending' | 'discarded'; error: string | null; keyPrefix: string },
): Promise<FindRow | null> {
  const { data } = await a.from('email_purchase_find').upsert({
    member_id: memberId,
    connection_id: connectionId,
    message_id: messageId,
    find_key: opts.keyPrefix + findKey(e, item),
    retailer: e.retailer,
    order_id: e.order_id,
    order_date: e.order_date,
    product_name: item.product_name,
    brand_name: item.brand_name,
    colour: item.colour,
    size: item.size,
    price: item.price,
    currency: item.currency,
    image_url: item.image_url,
    product_url: item.product_url,
    status: opts.status,
    error: opts.error,
  }, { onConflict: 'member_id,find_key', ignoreDuplicates: true }).select(FIND_COLS)
  const row = ((data ?? []) as FindRow[])[0]
  if (!row) return null
  finds.push(row)
  return row
}

async function searchInbox(c: any, text: string, max = 8): Promise<string[]> {
  const secret = decryptSecret(c.secret_enc)
  if (c.provider === 'gmail') return searchGmailIds(await googleAccessToken(secret), text, max)
  return searchImapUids({ host: c.imap_host, email: c.email, password: secret }, text.replace(/["]/g, ''), max)
}

/**
 * A photo for a piece whose order email had none. Vinted's order emails carry
 * no picture, but its "New message about <listing>" emails do — so look through
 * every email that names this piece and take the first product photo. Free: a
 * search and a few message reads, no AI.
 */
export async function huntPhotoForFind(memberId: string, findId: string): Promise<{ imageUrl?: string; error?: string }> {
  const a = db()
  const { data: f } = await a.from('email_purchase_find').select('find_id, connection_id, product_name, brand_name, image_url')
    .eq('find_id', findId).eq('member_id', memberId).maybeSingle()
  if (!f) return { error: 'Not found' }
  if (f.image_url) return { imageUrl: f.image_url }
  const { data: c } = await a.from('member_email_connection').select('*').eq('connection_id', f.connection_id).maybeSingle()
  if (!c) return { error: 'That inbox is no longer connected' }

  const words = pieceWords(f.product_name, null)
  if (words.length < 2) return { error: 'Not enough of a name to search for' }
  try {
    const ids = await searchInbox(c, `"${f.product_name.replace(/["]/g, '')}"`)
    for (const id of ids) {
      const m = await fetchMessages(c, [id])
      const { images } = emailForExtraction(m[0] ?? { id, subject: '', from: '', date: null, html: null, text: null })
      const photo = images[0]
      if (!photo) continue
      const hosted = await keepPhoto(photo, memberId, findId)
      // A seller's snapshot becomes a product photo now, so the card shows it clean.
      const shown = SNAPSHOT_RETAILER.test(f.retailer ?? '')
        ? (await cutoutToProductPhoto(hosted, memberId, findId)) ?? hosted
        : hosted
      await a.from('email_purchase_find').update({ image_url: shown, error: null }).eq('find_id', findId)
      return { imageUrl: shown }
    }
    return { error: 'No email with a photo of this piece' }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not look for a photo' }
  }
}

/**
 * Keep a photo for good. Cloudinary fetches most URLs itself, but some shops
 * (Vinted) sign theirs and refuse it, so the bytes are downloaded here instead.
 */
export async function keepFindPhoto(url: string, memberId: string, findId: string, retailer?: string | null): Promise<string> {
  const hosted = await keepPhoto(url, memberId, findId)
  return SNAPSHOT_RETAILER.test(retailer ?? '') ? (await cutoutToProductPhoto(hosted, memberId, findId)) ?? hosted : hosted
}

async function keepPhoto(url: string, memberId: string, findId: string): Promise<string> {
  const hosted = await persistImageToCloudinary(url, { folder: `wardrobe/email/${memberId.slice(0, 8)}` })
  if (hosted) return hosted
  try {
    const res = await fetch(url)
    const type = res.headers.get('content-type') ?? 'image/jpeg'
    if (!res.ok || !type.startsWith('image/')) return url
    const up = await uploadBufferToCloudinary(Buffer.from(await res.arrayBuffer()), {
      folder: `wardrobe/email/${memberId.slice(0, 8)}`, publicId: `find-${findId}`, contentType: type,
    })
    return up.url ?? url
  } catch {
    return url
  }
}

/** Lay every snapshot in her list out on white — for pieces found before cutouts existed. */
export async function cutoutPendingSnapshots(memberId: string, limit = 40): Promise<number> {
  const { data } = await db().from('email_purchase_find').select('find_id, retailer, image_url')
    .eq('member_id', memberId).eq('status', 'pending').not('image_url', 'is', null).limit(limit)
  let done = 0
  for (const f of (data ?? []) as any[]) {
    if (!SNAPSHOT_RETAILER.test(f.retailer ?? '') || isCutout(f.image_url)) continue
    const cut = await cutoutToProductPhoto(f.image_url, memberId, f.find_id)
    if (!cut) continue
    await db().from('email_purchase_find').update({ image_url: cut }).eq('find_id', f.find_id)
    done++
  }
  return done
}

/** Look for photos for every piece that has none — run when a scan finishes. */
export async function huntMissingPhotos(memberId: string, limit = 40): Promise<number> {
  const { data } = await db().from('email_purchase_find').select('find_id')
    .eq('member_id', memberId).eq('status', 'pending').is('image_url', null).limit(limit)
  let found = 0
  for (const f of (data ?? []) as any[]) {
    const r = await huntPhotoForFind(memberId, f.find_id)
    if (r.imageUrl) found++
  }
  return found
}

/**
 * A seller's or her own snapshot — on a hanger, in a room — is not a product
 * photo. Marketplace pieces and photos she uploads go through the SAME cutout
 * the wardrobe import uses, so they land on white like a shop's own image.
 */
const SNAPSHOT_RETAILER = /vinted|ebay|depop|vestiaire|etsy|facebook|gumtree/i

/** Already laid out on white by us — Cloudinary folds the folder into the public id. */
const isCutout = (url: string | null | undefined) => /cutout-/.test(url ?? '')

async function cutoutToProductPhoto(imageUrl: string, memberId: string, findId: string, attempt = 0): Promise<string | null> {
  if (!openAiConfigured()) return null
  try {
    const res = await fetch(imageUrl)
    if (!res.ok) return null
    const { png } = await normalisePhoto(Buffer.from(await res.arrayBuffer()))
    const det = await detectGarments(await detectorJpeg(png))
    // The piece the photo is of: the biggest thing detected.
    const g = [...det.garments].sort((x, y) => y.bounding_box.width * y.bounding_box.height - x.bounding_box.width * x.bounding_box.height)[0]
    if (!g) return null
    const crop = await cropGarment(png, g.bounding_box, 0.12)
    let out = await editToCutout(crop, buildCutoutPrompt(g))
    const check = await cutoutLooksValid(out.png)
    if (!check.ok) {
      out = await editToCutout(crop, `${buildCutoutPrompt(g)}\n\nThe previous attempt failed because: ${check.reason}. The background must be uniform pure white edge to edge and the complete garment must be clearly visible in the centre.`)
    }
    const up = await uploadBufferToCloudinary(await frameOnWhite(out.png), {
      folder: `wardrobe/email/${memberId.slice(0, 8)}`, publicId: `cutout-${findId}-${Date.now()}`, contentType: 'image/jpeg',
    })
    return up.url ?? null
  } catch (err) {
    // OpenAI times out now and then; one more go before she is left with the snapshot.
    console.error('[cutoutToProductPhoto]', findId, err instanceof Error ? err.message : err)
    if (attempt < 1) return cutoutToProductPhoto(imageUrl, memberId, findId, attempt + 1)
    return null
  }
}

/** A photo she adds to a find whose email had none (Vinted sends none). */
export async function setFindPhoto(memberId: string, findId: string, bytes: Buffer, contentType: string): Promise<{ error?: string }> {
  const a = db()
  const { data: f } = await a.from('email_purchase_find').select('find_id').eq('find_id', findId).eq('member_id', memberId).maybeSingle()
  if (!f) return { error: 'Not found' }
  const up = await uploadBufferToCloudinary(bytes, { folder: `wardrobe/email/${memberId.slice(0, 8)}`, publicId: `find-${findId}-${Date.now()}`, contentType })
  if (!up.url) return { error: up.error ?? 'Upload failed' }
  // Her own photo of the piece, laid out on white like a shop's.
  const shown = (await cutoutToProductPhoto(up.url, memberId, findId)) ?? up.url
  const { error } = await a.from('email_purchase_find').update({ image_url: shown, error: null }).eq('find_id', findId)
  return error ? { error: error.message } : {}
}

/** Pieces already in her dressing room that an email says went back. */
export async function listReturnedInWardrobe(memberId: string): Promise<EmailFindView[]> {
  const { data } = await db().from('email_purchase_find')
    .select('find_id, retailer, order_date, product_name, brand_name, colour, size, price, currency, image_url, product_url, status, error, item_id')
    .eq('member_id', memberId).eq('status', 'approved').eq('error', RETURNED).limit(100)
  return ((data ?? []) as any[]).map((r) => ({ ...r, price: r.price != null ? Number(r.price) : null }))
}

/** She sent it back: take it out of the dressing room and rebuild looks that used it. */
export async function removeReturnedPiece(memberId: string, findId: string): Promise<{ error?: string }> {
  const a = db()
  const { data: f } = await a.from('email_purchase_find').select('find_id, item_id')
    .eq('find_id', findId).eq('member_id', memberId).maybeSingle()
  if (!f?.item_id) return { error: 'Not found' }
  const r = await deleteOwnedItem(f.item_id, [{ kind: 'pilot_member', id: memberId }])
  if (r.error) return r
  await rebuildLooksWithoutItems([f.item_id])
  await a.from('email_purchase_find').update({ status: 'discarded', error: RETURNED }).eq('find_id', findId)
  return {}
}

/** She still has it (kept after all, or the return was for another size). */
export async function keepReturnedPiece(memberId: string, findId: string): Promise<{ error?: string }> {
  const { error } = await db().from('email_purchase_find').update({ error: null })
    .eq('find_id', findId).eq('member_id', memberId).eq('status', 'approved')
  return error ? { error: error.message } : {}
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
  let hosted = (await persistImageToCloudinary(source, { folder: `wardrobe/email/${memberId.slice(0, 8)}` })) ?? source
  // A snapshot from a marketplace becomes a product photo on white first.
  if (!fromPage && !isCutout(hosted) && SNAPSHOT_RETAILER.test(f.retailer ?? '')) {
    hosted = (await cutoutToProductPhoto(hosted, memberId, findId)) ?? hosted
  }

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
