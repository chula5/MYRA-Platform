// ── Saved-item stock alerts, scoped to her size ──────────────────────────────
//
// Saving something subscribes her to stock events for the items in it. Two
// rules shape everything here:
//
//   NEVER ALERT ON A SIZE SHE DOESN'T WEAR. The sizes to watch are frozen onto
//   the subscription when she saves, not re-derived at send time — so changing
//   her profile later can't retroactively spam her about pieces she saved as a
//   different size, and a size-16 sell-out never reaches a size-8 shopper.
//
//   NEVER ONE EMAIL PER EVENT. Everything batches into a daily digest, except
//   low stock on a unique or fast-moving piece, which sends within the hour —
//   by tomorrow that one would be an apology, not an alert.

import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import { acceptedValues, sizeCategoryFor, type SizeCategory } from '@/lib/size-canonical'
import { loadUserSizeProfile, loadMemberSizeProfile, loadSizeRowsFor, type ShopperSizeContext } from '@/lib/size-availability'
import { notifyMember } from '@/lib/push/notify'
import type { SizeRow } from '@/lib/size-match'
import { alertPriority, isFastMoving, type StockClass, type RiskInputs } from '@/lib/second-hand'
import { sendStudioEmail, emailShell, emailButton, siteUrl } from '@/lib/studio/email'

// The kinds, their copy and the saved-list shape live in a client-safe module
// so the wardrobe panel can render them without importing this one.
export {
  ALERT_COPY,
  type AlertKind,
  type SubscriptionSource,
  type UserAlert,
} from '@/lib/stock-alert-copy'
import { ALERT_COPY, type AlertKind, type SubscriptionSource, type UserAlert } from '@/lib/stock-alert-copy'

// ── Subscriptions ────────────────────────────────────────────────────────────

interface SubscribableItem {
  item_id: string
  item_type?: string | null
}

/**
 * Subscribe a user to stock events for a set of items, scoped to her size.
 *
 * An item whose category she has no size for gets an empty watch list — she
 * still hears about the piece disappearing entirely, just never about a
 * specific size. That is the honest fallback: silence about sizes we don't know
 * beats guessing one for her.
 */
export async function subscribeToItems(
  userId: string,
  items: SubscribableItem[],
  source: SubscriptionSource,
  outfitId?: string | null,
  ctx?: ShopperSizeContext,
): Promise<void> {
  if (!items.length) return
  try {
    const admin = createAdminClient()
    const sizes = ctx ?? (await sizesForAlertKey(userId))
    const rows = items.map((item) => {
      const category = sizeCategoryFor(item.item_type as any)
      const values = category ? acceptedValues(sizes.profile, category) : []
      return {
        user_id: userId,
        item_id: item.item_id,
        outfit_id: outfitId ?? null,
        source,
        watch_category: values.length ? category : null,
        watch_values: values,
        active: true,
      }
    })
    const { error } = await (admin.from('stock_subscription') as any).upsert(rows, {
      onConflict: 'user_id,item_id,source',
    })
    if (error) throw error
  } catch (err) {
    // Alerting must never break a save.
    console.error('[subscribeToItems]', err)
  }
}

/**
 * The sizes to watch for whoever holds this alert key. A member's sizes live on
 * her member record (pilot_member.sizes), not in the shopper size profile, so a
 * heart tapped by a member used to watch no size at all and never alerted.
 */
async function sizesForAlertKey(userId: string): Promise<ShopperSizeContext> {
  const shopper = await loadUserSizeProfile(userId)
  if (shopper.hasProfile) return shopper
  try {
    const admin = createAdminClient() as any
    const { data } = await admin.from('pilot_member').select('member_id')
      .or(`auth_user_id.eq.${userId},member_id.eq.${userId}`).limit(1).maybeSingle()
    if (data?.member_id) return await loadMemberSizeProfile(data.member_id)
  } catch { /* fall back to the shopper profile */ }
  return shopper
}

/** Subscribe to every item in an outfit she just saved. */
export async function subscribeToOutfit(userId: string, outfitId: string): Promise<void> {
  try {
    const admin = createAdminClient()
    const { data } = await admin
      .from('outfit_item' as any)
      .select('item_id, item(item_id, item_type)')
      .eq('outfit_id', outfitId)
    const items = ((data ?? []) as any[])
      .map((r) => r.item)
      .filter(Boolean)
      .map((i: any) => ({ item_id: i.item_id, item_type: i.item_type }))
    await subscribeToItems(userId, items, 'saved_outfit', outfitId)
  } catch (err) {
    console.error('[subscribeToOutfit]', err)
  }
}

export async function unsubscribe(
  userId: string,
  itemId: string,
  source: SubscriptionSource,
): Promise<void> {
  try {
    const admin = createAdminClient()
    await admin
      .from('stock_subscription' as any)
      .delete()
      .eq('user_id', userId)
      .eq('item_id', itemId)
      .eq('source', source)
  } catch (err) {
    console.error('[unsubscribe]', err)
  }
}

export async function unsubscribeOutfit(userId: string, outfitId: string): Promise<void> {
  try {
    const admin = createAdminClient()
    await admin
      .from('stock_subscription' as any)
      .delete()
      .eq('user_id', userId)
      .eq('outfit_id', outfitId)
      .eq('source', 'saved_outfit')
  } catch (err) {
    console.error('[unsubscribeOutfit]', err)
  }
}

/** "Notify me if it returns" from the sourcing panel. */
export async function notifyMeOnRestock(
  userId: string,
  item: SubscribableItem,
): Promise<{ error?: string }> {
  try {
    await subscribeToItems(userId, [item], 'notify_me')
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not set the reminder' }
  }
}

// ── Emitting ─────────────────────────────────────────────────────────────────

export async function emitAlert(opts: {
  userId: string
  itemId: string
  outfitId?: string | null
  kind: AlertKind
  priority: 'urgent' | 'batch'
  sizeLabel?: string | null
}): Promise<void> {
  try {
    const admin = createAdminClient()
    // One live alert of a kind per user per item. A repeat sweep must not spam,
    // so an existing undelivered row is left exactly as it is.
    const { data: existing } = await admin
      .from('stock_alert' as any)
      .select('alert_id, delivered_at')
      .eq('user_id', opts.userId)
      .eq('item_id', opts.itemId)
      .eq('kind', opts.kind)
      .maybeSingle()

    if (existing) {
      if ((existing as any).delivered_at == null) return // already queued
      // Genuinely happened again after we told her — reopen it.
      await (admin.from('stock_alert') as any)
        .update({
          delivered_at: null, seen_at: null, priority: opts.priority,
          size_label: opts.sizeLabel ?? null, created_at: new Date().toISOString(),
        })
        .eq('alert_id', (existing as any).alert_id)
      return
    }

    await (admin.from('stock_alert') as any).insert({
      user_id: opts.userId,
      item_id: opts.itemId,
      outfit_id: opts.outfitId ?? null,
      kind: opts.kind,
      priority: opts.priority,
      size_label: opts.sizeLabel ?? null,
    })
  } catch (err) {
    console.error('[emitAlert]', err)
  }
}

/** Retract alerts a later event has made untrue (a sell-out that came back). */
export async function clearAlerts(userId: string, itemId: string, kinds: AlertKind[]): Promise<void> {
  try {
    const admin = createAdminClient()
    await admin
      .from('stock_alert' as any)
      .delete()
      .eq('user_id', userId)
      .eq('item_id', itemId)
      .in('kind', kinds)
      .is('delivered_at', null)
  } catch (err) {
    console.error('[clearAlerts]', err)
  }
}

interface Subscription {
  user_id: string
  item_id: string
  outfit_id: string | null
  watch_category: SizeCategory | null
  watch_values: number[]
}

async function subscribersFor(itemId: string): Promise<Subscription[]> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('stock_subscription' as any)
    .select('user_id, item_id, outfit_id, watch_category, watch_values')
    .eq('item_id', itemId)
    .eq('active', true)
  return ((data ?? []) as any[]).map((r) => ({
    ...r,
    watch_values: (r.watch_values ?? []).map(Number),
  })) as Subscription[]
}

const valuesOf = (r: SizeRow): number[] => {
  const arr = (r.canonical_values ?? []).filter((n) => n != null) as number[]
  return arr.length ? arr : r.canonical_value != null ? [r.canonical_value] : []
}

const watchesRow = (sub: Subscription, row: SizeRow): boolean =>
  sub.watch_values.length > 0 && valuesOf(row).some((v) => sub.watch_values.includes(v))

/**
 * Diff an item's size rows before/after a check and raise the alerts that
 * follow, per subscriber, in her sizes only.
 */
export async function raiseSizeAlerts(opts: {
  itemId: string
  before: SizeRow[]
  after: SizeRow[]
  stockClass: StockClass
  risk?: RiskInputs
}): Promise<number> {
  const subs = await subscribersFor(opts.itemId)
  if (!subs.length) return 0

  const beforeBy = new Map(opts.before.map((r) => [r.size_label, r]))
  const fastMoving = opts.risk ? isFastMoving(opts.risk) : false
  let raised = 0

  for (const sub of subs) {
    for (const row of opts.after) {
      if (!watchesRow(sub, row)) continue
      const was = beforeBy.get(row.size_label)
      const wasIn = was ? was.in_stock && was.stock_level !== 'sold_out' : null
      const isIn = row.in_stock && row.stock_level !== 'sold_out'

      let kind: AlertKind | null = null
      if (isIn && row.stock_level === 'low' && (!was || was.stock_level !== 'low')) kind = 'low_in_size'
      else if (wasIn === true && !isIn) kind = 'sold_out_in_size'
      else if (wasIn === false && isIn) kind = 'back_in_size'
      if (!kind) continue

      if (kind === 'back_in_size') await clearAlerts(sub.user_id, sub.item_id, ['sold_out_in_size', 'low_in_size'])
      if (kind === 'sold_out_in_size') await clearAlerts(sub.user_id, sub.item_id, ['low_in_size', 'back_in_size'])

      await emitAlert({
        userId: sub.user_id,
        itemId: sub.item_id,
        outfitId: sub.outfit_id,
        kind,
        priority: alertPriority(kind, { stockClass: opts.stockClass, fastMoving }),
        sizeLabel: row.size_label,
      })
      raised++
    }
  }
  return raised
}

/** A one-of-one has sold — tell everyone watching it, at once, not tomorrow. */
export async function raiseUniqueSoldAlerts(itemId: string): Promise<number> {
  const subs = await subscribersFor(itemId)
  for (const sub of subs) {
    await clearAlerts(sub.user_id, itemId, ['low_in_size', 'back_in_size', 'sold_out_in_size'])
    await emitAlert({
      userId: sub.user_id,
      itemId,
      outfitId: sub.outfit_id,
      kind: 'unique_sold',
      priority: 'urgent',
    })
  }
  // Nothing can come back — stop watching it.
  try {
    const admin = createAdminClient()
    await (admin.from('stock_subscription') as any).update({ active: false }).eq('item_id', itemId)
  } catch (err) {
    console.error('[raiseUniqueSoldAlerts] deactivate', err)
  }
  return subs.length
}

// ── In-app surface ───────────────────────────────────────────────────────────

export async function listUserAlerts(userId: string, limit = 40): Promise<UserAlert[]> {
  try {
    const admin = createAdminClient()
    const { data } = await admin
      .from('stock_alert' as any)
      .select('alert_id, item_id, outfit_id, kind, size_label, created_at, seen_at, item(product_name, image_url, brand(name))')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit)
    return ((data ?? []) as any[]).map((r) => ({
      alert_id: r.alert_id,
      item_id: r.item_id,
      outfit_id: r.outfit_id,
      kind: r.kind,
      size_label: r.size_label,
      created_at: r.created_at,
      seen_at: r.seen_at,
      product_name: r.item?.product_name ?? null,
      brand_name: r.item?.brand?.name ?? null,
      image_url: r.item?.image_url ?? null,
    }))
  } catch (err) {
    console.error('[listUserAlerts]', err)
    return []
  }
}

export async function markAlertsSeen(userId: string, alertIds?: string[]): Promise<void> {
  try {
    const admin = createAdminClient()
    let q = (admin.from('stock_alert') as any)
      .update({ seen_at: new Date().toISOString() })
      .eq('user_id', userId)
      .is('seen_at', null)
    if (alertIds?.length) q = q.in('alert_id', alertIds)
    await q
  } catch (err) {
    console.error('[markAlertsSeen]', err)
  }
}

// ── Delivery ─────────────────────────────────────────────────────────────────

interface PendingRow {
  alert_id: string
  user_id: string
  item_id: string
  outfit_id: string | null
  kind: AlertKind
  size_label: string | null
  item: { product_name: string; image_url: string | null; retailer_url: string | null; brand: { name: string } | null } | null
}

/**
 * Send what's due. `mode: 'urgent'` runs hourly and picks up only the alerts
 * that can't wait; `mode: 'batch'` runs once a day and sweeps everything
 * outstanding, urgent leftovers included.
 *
 * Private-stylist clients are excluded: theirs arrive inside the existing
 * stylist digest rather than as a second email from the same brand.
 */
export async function deliverAlerts(mode: 'urgent' | 'batch'): Promise<{ users: number; alerts: number }> {
  const admin = createAdminClient()
  let query = admin
    .from('stock_alert' as any)
    .select('alert_id, user_id, item_id, outfit_id, kind, size_label, priority, created_at, item(product_name, image_url, retailer_url, brand(name))')
    .is('delivered_at', null)
    .order('created_at', { ascending: true })
    .limit(1000)

  const { data, error } = await query
  if (error) { console.error('[deliverAlerts]', error); return { users: 0, alerts: 0 } }
  const rows = (data ?? []) as unknown as PendingRow[]
  if (!rows.length) return { users: 0, alerts: 0 }

  const privateClients = await privateClientUserIds()
  const members = await memberForAlertKey()

  const byUser = new Map<string, PendingRow[]>()
  const byMember = new Map<string, PendingRow[]>()
  for (const r of rows) {
    // A MYRA member hears it in the app and on her phone (lib/push), at once.
    // Every kind, every hour: "only a few left" is no use tomorrow morning.
    const memberId = members.get(r.user_id)
    if (memberId) { byMember.set(memberId, [...(byMember.get(memberId) ?? []), r]); continue }
    if (mode === 'urgent' && (r as any).priority !== 'urgent') continue
    if (privateClients.has(r.user_id)) continue // handled by the stylist digest
    const list = byUser.get(r.user_id) ?? []
    list.push(r)
    byUser.set(r.user_id, list)
  }

  let sentUsers = 0
  let sentAlerts = 0
  for (const [memberId, memberRows] of Array.from(byMember.entries())) {
    try {
      // News older than two days is stale on a phone: filed as delivered, not sent.
      const fresh = memberRows.filter((r: any) => Date.now() - Date.parse(r.created_at) < 48 * 3600_000)
      if (fresh.length) await tellMemberAboutStock(admin, memberId, fresh)
      await (admin.from('stock_alert') as any)
        .update({ delivered_at: new Date().toISOString() })
        .in('alert_id', memberRows.map((r: PendingRow) => r.alert_id))
      sentUsers++
      sentAlerts += memberRows.length
    } catch (err) { console.error('[deliverAlerts] member', memberId, err) }
  }
  for (const [userId, userRows] of Array.from(byUser.entries())) {
    const email = await emailFor(userId)
    if (!email) continue
    const res = await sendStudioEmail({
      kind: mode === 'urgent' ? 'shopper_stock_urgent' : 'shopper_stock_digest',
      subject: subjectFor(userRows, mode),
      html: digestHtml(userRows),
      to: email,
      meta: { userId, count: userRows.length, mode },
    })
    if (!res.sent) continue
    await (admin.from('stock_alert') as any)
      .update({ delivered_at: new Date().toISOString() })
      .in('alert_id', userRows.map((r: PendingRow) => r.alert_id))
    sentUsers++
    sentAlerts += userRows.length
  }
  return { users: sentUsers, alerts: sentAlerts }
}

/** Undelivered alerts for a private client, for embedding in her stylist digest. */
export async function pendingAlertsForUser(userId: string): Promise<PendingRow[]> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('stock_alert' as any)
    .select('alert_id, user_id, item_id, outfit_id, kind, size_label, item(product_name, image_url, retailer_url, brand(name))')
    .eq('user_id', userId)
    .is('delivered_at', null)
    .order('created_at', { ascending: true })
  return (data ?? []) as unknown as PendingRow[]
}

export async function markDelivered(alertIds: string[]): Promise<void> {
  if (!alertIds.length) return
  const admin = createAdminClient()
  await (admin.from('stock_alert') as any)
    .update({ delivered_at: new Date().toISOString() })
    .in('alert_id', alertIds)
}

/**
 * Everyone whose stock news belongs in a stylist delivery instead of the
 * shopper digest. Both identities count: client_profile is the client-area
 * record, pilot_member.auth_user_id is the private-stylist one, and a client
 * can have either or both.
 */
async function privateClientUserIds(): Promise<Set<string>> {
  const ids = new Set<string>()
  const admin = createAdminClient()
  try {
    const { data } = await admin.from('client_profile' as any).select('user_id')
    for (const r of (data ?? []) as any[]) if (r.user_id) ids.add(r.user_id)
  } catch { /* table may not exist in every environment */ }
  try {
    const { data } = await admin.from('pilot_member' as any).select('auth_user_id')
    for (const r of (data ?? []) as any[]) if (r.auth_user_id) ids.add(r.auth_user_id)
  } catch { /* same */ }
  return ids
}

/** Every alert key a member's saves are filed under (her login, else her member id) → her member id. */
async function memberForAlertKey(): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  try {
    const admin = createAdminClient()
    const { data } = await admin.from('pilot_member' as any).select('member_id, auth_user_id').eq('is_synthetic', false)
    for (const m of (data ?? []) as any[]) {
      out.set(m.member_id, m.member_id)
      if (m.auth_user_id) out.set(m.auth_user_id, m.member_id)
    }
  } catch { /* no members table: shoppers only */ }
  return out
}

/** Words for her phone, piece by piece — the urgent ones first, three at most, the rest in one line. */
const STOCK_ORDER: AlertKind[] = ['unique_sold', 'low_in_size', 'sold_out_in_size', 'back_in_size', 'restyled']
async function tellMemberAboutStock(admin: any, memberId: string, rows: PendingRow[]): Promise<void> {
  const sorted = rows.slice().sort((a, b) => STOCK_ORDER.indexOf(a.kind as AlertKind) - STOCK_ORDER.indexOf(b.kind as AlertKind))
  const named = (r: PendingRow) => [r.item?.brand?.name, r.item?.product_name].filter(Boolean).join(' ') || 'A piece you saved'
  for (const r of sorted.slice(0, 3)) {
    const line = ALERT_COPY[r.kind as AlertKind]?.(r.size_label) ?? 'Stock has changed'
    await notifyMember(admin,
      { memberId, kind: 'note', body: `${named(r)}: ${line.charAt(0).toLowerCase()}${line.slice(1)}.` },
      { title: r.kind === 'low_in_size' ? 'Nearly gone in your size' : r.kind === 'back_in_size' ? 'Back in your size' : 'A saved piece changed', url: `/me/dressing-room?tab=saved&piece=${r.item_id}`, collapseId: `stock-${r.item_id}` })
  }
  if (sorted.length > 3) {
    await notifyMember(admin,
      { memberId, kind: 'note', body: `${sorted.length - 3} more of your saved pieces changed in stock. See them in your Dressing Room.` },
      { title: 'Your saved pieces', url: '/me/dressing-room?tab=saved', collapseId: 'stock-more' })
  }
}

async function emailFor(userId: string): Promise<string | null> {
  try {
    const admin = createAdminClient()
    const { data } = await admin.auth.admin.getUserById(userId)
    return data?.user?.email ?? null
  } catch {
    return null
  }
}

function subjectFor(rows: PendingRow[], mode: 'urgent' | 'batch'): string {
  if (mode === 'urgent') {
    const sold = rows.find((r) => r.kind === 'unique_sold')
    if (sold) return 'MYRA — a one-of-one you saved has sold'
    return 'MYRA — low stock in your size'
  }
  return rows.length === 1
    ? `MYRA — an update on something you saved`
    : `MYRA — ${rows.length} updates on things you saved`
}

function digestHtml(rows: PendingRow[]): string {
  const body = rows
    .map((r) => {
      const name = r.item?.product_name ?? 'A piece you saved'
      const brand = r.item?.brand?.name ?? ''
      const line = ALERT_COPY[r.kind](r.size_label)
      const img = r.item?.image_url
        ? `<img src="${r.item.image_url}" width="72" style="display:block;width:72px;border-radius:6px;border:1px solid #e2e0db;" />`
        : `<div style="width:72px;height:96px;background:#ededed;border-radius:6px;"></div>`
      return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 14px 0;"><tr>
<td style="padding-right:14px;vertical-align:top;">${img}</td>
<td style="vertical-align:top;font-family:Helvetica,Arial,sans-serif;">
  <p style="margin:0;font-size:11px;letter-spacing:0.1em;color:#a8a8a4;text-transform:uppercase;">${brand}</p>
  <p style="margin:2px 0 4px 0;font-size:14px;color:#4a4e57;">${name}</p>
  <p style="margin:0;font-size:13px;color:#0a0a0a;">${line}</p>
</td></tr></table>`
    })
    .join('')

  const anyRestyle = rows.some((r) => r.kind === 'restyled' || r.kind === 'unique_sold')
  const closing = anyRestyle
    ? `<p style="margin:18px 0 0 0;font-size:13px;color:#6b6b6b;">An item in a look you saved has sold — here's how we'd restyle it.</p>`
    : ''

  return emailShell(
    'YOUR SAVED PIECES',
    `${body}${closing}<p style="margin:22px 0 0 0;">${emailButton(siteUrl('/me'), 'OPEN YOUR WARDROBE')}</p>`,
    'MYRA · YOU CAN CHANGE WHAT YOU HEAR ABOUT IN YOUR SETTINGS',
  )
}
