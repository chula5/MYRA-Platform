'use server'

// SHARING IS CARING — her friends on MYRA and the chats they share in.
//
// The member is always resolved on the server (her session, or the member
// Chloe names from HER VIEW). A friendship is two-sided: one asks, the other
// accepts, and nothing is shared until both have said yes. Testing as her
// (Chloe from HER VIEW) reads everything and sends nothing — a message sent
// as her would reach a real friend.
//
// Tables: migration 0100 (member_friendship, share_chat, share_chat_member,
// share_message; pilot_member.handle / .email).

import { createAdminClient } from '@/lib/supabase-server'
import { resolveClientMember, firstNameOf } from '@/lib/client-member'

export interface Friend {
  member_id: string
  name: string
  handle: string | null
}

export interface FriendRequest extends Friend {
  friendship_id: string
  created_at: string
}

/** Someone found by email or handle, and where she stands with them. */
export interface FoundPerson extends Friend {
  relationship: 'none' | 'friends' | 'asked' | 'asked_you' | 'you'
  friendship_id?: string
}

export type ShareAttachment =
  | {
      kind: 'look'
      look_id?: string | null
      image_url: string | null
      occasion_label?: string | null
      items: { brand: string; product_name: string; image_url: string | null; url: string | null; price_gbp: number | null; item_id: string | null }[]
    }
  | {
      kind: 'piece'
      item_id: string | null
      brand: string | null
      product_name: string
      image_url: string | null
      url: string | null
      price_gbp: number | null
    }
  | { kind: 'link'; url: string; title?: string | null; image_url?: string | null }

export interface ShareMessage {
  message_id: string
  chat_id: string
  sender_id: string | null
  sender_name: string
  mine: boolean
  kind: 'text' | 'look' | 'piece' | 'link'
  body: string
  payload: ShareAttachment | null
  created_at: string
}

export interface ChatSummary {
  chat_id: string
  /** What the chat is called for her: the friend's name, or the group's title. */
  title: string
  is_group: boolean
  others: Friend[]
  last: { body: string; kind: ShareMessage['kind']; sender_name: string; mine: boolean; created_at: string } | null
  unread: number
}

export interface SharingView {
  memberId: string | null
  name: string
  handle: string | null
  email: string | null
  test: boolean
  friends: Friend[]
  requestsIn: FriendRequest[]
  requestsOut: FriendRequest[]
  chats: ChatSummary[]
  error?: string
}

const EMPTY: SharingView = { memberId: null, name: '', handle: null, email: null, test: false, friends: [], requestsIn: [], requestsOut: [], chats: [] }
const NOT_SENT = 'Testing as her — nothing is sent'
const MEMBER_COLS = 'member_id, name, handle'

const asFriend = (m: any): Friend => ({ member_id: m.member_id, name: m.name ?? '', handle: m.handle ?? null })

/** One line that stands for an attachment in a chat list or a note. */
function describe(kind: ShareMessage['kind'], payload: ShareAttachment | null, body: string): string {
  if (body.trim()) return body.trim()
  if (kind === 'look') return 'Shared an outfit'
  if (kind === 'piece') return payload && payload.kind === 'piece' ? `Shared ${payload.brand ? `a ${payload.brand} piece` : 'a piece'}` : 'Shared a piece'
  if (kind === 'link') return 'Shared a link'
  return ''
}

// ── The room ────────────────────────────────────────────────────────────────

export async function loadSharing(asMemberId?: string): Promise<SharingView> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return EMPTY
  const admin = createAdminClient() as any
  try {
    const [{ data: mine }, { data: ships }, { data: memberships }] = await Promise.all([
      admin.from('pilot_member').select('handle, email').eq('member_id', me.memberId).maybeSingle(),
      admin.from('member_friendship').select('friendship_id, requester_id, addressee_id, status, created_at')
        .or(`requester_id.eq.${me.memberId},addressee_id.eq.${me.memberId}`).neq('status', 'declined'),
      admin.from('share_chat_member').select('chat_id, last_read_at').eq('member_id', me.memberId),
    ])

    // Everyone the friendships name, in one read.
    const otherIds = new Set<string>()
    for (const s of (ships ?? []) as any[]) otherIds.add(s.requester_id === me.memberId ? s.addressee_id : s.requester_id)
    const chatIds = ((memberships ?? []) as any[]).map((m) => m.chat_id)
    const { data: chatMembers } = chatIds.length
      ? await admin.from('share_chat_member').select('chat_id, member_id').in('chat_id', chatIds)
      : { data: [] }
    for (const cm of (chatMembers ?? []) as any[]) if (cm.member_id !== me.memberId) otherIds.add(cm.member_id)
    const { data: people } = otherIds.size
      ? await admin.from('pilot_member').select(MEMBER_COLS).in('member_id', Array.from(otherIds))
      : { data: [] }
    const byId = new Map<string, Friend>(((people ?? []) as any[]).map((p) => [p.member_id, asFriend(p)]))
    const unknown = (id: string): Friend => ({ member_id: id, name: 'A member', handle: null })

    const friends: Friend[] = []
    const requestsIn: FriendRequest[] = []
    const requestsOut: FriendRequest[] = []
    for (const s of (ships ?? []) as any[]) {
      const otherId = s.requester_id === me.memberId ? s.addressee_id : s.requester_id
      const other = byId.get(otherId) ?? unknown(otherId)
      if (s.status === 'accepted') friends.push(other)
      else if (s.requester_id === me.memberId) requestsOut.push({ ...other, friendship_id: s.friendship_id, created_at: s.created_at })
      else requestsIn.push({ ...other, friendship_id: s.friendship_id, created_at: s.created_at })
    }
    friends.sort((a, b) => a.name.localeCompare(b.name))

    // The chats: who is in each, the last word said, and what she has not read.
    const { data: chatRows } = chatIds.length
      ? await admin.from('share_chat').select('chat_id, title, is_group, last_message_at').in('chat_id', chatIds)
      : { data: [] }
    const lastRead = new Map<string, string | null>(((memberships ?? []) as any[]).map((m) => [m.chat_id, m.last_read_at]))
    const chats = await Promise.all(((chatRows ?? []) as any[]).map(async (c): Promise<ChatSummary> => {
      const others = ((chatMembers ?? []) as any[]).filter((cm) => cm.chat_id === c.chat_id && cm.member_id !== me.memberId)
        .map((cm) => byId.get(cm.member_id) ?? unknown(cm.member_id))
      const [{ data: lastRows }, { count }] = await Promise.all([
        admin.from('share_message').select('body, kind, payload, sender_id, created_at').eq('chat_id', c.chat_id)
          .order('created_at', { ascending: false }).limit(1),
        (() => {
          let q = admin.from('share_message').select('message_id', { count: 'exact', head: true }).eq('chat_id', c.chat_id).neq('sender_id', me.memberId)
          const since = lastRead.get(c.chat_id)
          if (since) q = q.gt('created_at', since)
          return q
        })(),
      ])
      const l = (lastRows ?? [])[0] as any | undefined
      const senderName = l ? (l.sender_id === me.memberId ? 'You' : firstNameOf((byId.get(l.sender_id)?.name) ?? 'A friend')) : ''
      return {
        chat_id: c.chat_id,
        title: c.is_group ? (c.title || others.map((o) => firstNameOf(o.name)).join(', ') || 'Group') : (others[0]?.name ?? 'A friend'),
        is_group: !!c.is_group,
        others,
        last: l ? { body: describe(l.kind, l.payload, l.body), kind: l.kind, sender_name: senderName, mine: l.sender_id === me.memberId, created_at: l.created_at } : null,
        unread: count ?? 0,
      }
    }))
    chats.sort((a, b) => (b.last?.created_at ?? '').localeCompare(a.last?.created_at ?? ''))

    return {
      memberId: me.memberId, name: me.name, handle: mine?.handle ?? null, email: mine?.email ?? null, test: me.test,
      friends, requestsIn, requestsOut, chats,
    }
  } catch (err) {
    return { ...EMPTY, memberId: me.memberId, name: me.name, test: me.test, error: err instanceof Error ? err.message : 'Could not open sharing' }
  }
}

/** For the icon in the header: what she has not seen — new messages and friends asking. */
export async function sharingUnread(asMemberId?: string): Promise<{ count: number }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { count: 0 }
  try {
    const admin = createAdminClient() as any
    const [{ count: asks }, { data: memberships }] = await Promise.all([
      admin.from('member_friendship').select('friendship_id', { count: 'exact', head: true }).eq('addressee_id', me.memberId).eq('status', 'pending'),
      admin.from('share_chat_member').select('chat_id, last_read_at').eq('member_id', me.memberId),
    ])
    const counts = await Promise.all(((memberships ?? []) as any[]).map(async (m) => {
      let q = admin.from('share_message').select('message_id', { count: 'exact', head: true }).eq('chat_id', m.chat_id).neq('sender_id', me.memberId)
      if (m.last_read_at) q = q.gt('created_at', m.last_read_at)
      const { count } = await q
      return count ?? 0
    }))
    return { count: (asks ?? 0) + counts.reduce((a: number, b: number) => a + b, 0) }
  } catch {
    return { count: 0 }
  }
}

// ── Friends ─────────────────────────────────────────────────────────────────

/** Just her friends — for the SHARE control on a look or a piece. */
export async function listMyFriends(asMemberId?: string): Promise<{ friends: Friend[]; test: boolean; error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { friends: [], test: false, error: 'Not signed in' }
  try {
    const admin = createAdminClient() as any
    const { data: ships } = await admin.from('member_friendship').select('requester_id, addressee_id')
      .or(`requester_id.eq.${me.memberId},addressee_id.eq.${me.memberId}`).eq('status', 'accepted')
    const ids = ((ships ?? []) as any[]).map((s) => (s.requester_id === me.memberId ? s.addressee_id : s.requester_id))
    if (!ids.length) return { friends: [], test: me.test }
    const { data } = await admin.from('pilot_member').select(MEMBER_COLS).in('member_id', ids).order('name')
    return { friends: ((data ?? []) as any[]).map(asFriend), test: me.test }
  } catch (err) {
    return { friends: [], test: me.test, error: err instanceof Error ? err.message : 'Could not read your friends' }
  }
}

const HANDLE_RE = /^[a-z0-9._]{2,30}$/

/** Find a person by her email or her handle (or the start of her name). */
export async function findPeople(query: string, asMemberId?: string): Promise<{ people: FoundPerson[]; error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { people: [], error: 'Not signed in' }
  const q = (query ?? '').trim().toLowerCase().replace(/^@/, '')
  if (q.length < 2) return { people: [] }
  const admin = createAdminClient() as any
  try {
    const isEmail = q.includes('@')
    let rows: any[] = []
    if (isEmail) {
      const { data } = await admin.from('pilot_member').select(`${MEMBER_COLS}, auth_user_id`).eq('email', q).limit(5)
      rows = data ?? []
      // Her login's email may not be copied onto her member row yet: look the
      // login up, then the member it belongs to, and keep the email for next time.
      if (!rows.length) {
        const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
        const user = ((users?.users ?? []) as any[]).find((u) => (u.email ?? '').toLowerCase() === q)
        if (user) {
          const { data } = await admin.from('pilot_member').select(`${MEMBER_COLS}, auth_user_id`).eq('auth_user_id', user.id).limit(1)
          rows = data ?? []
          if (rows[0]) await admin.from('pilot_member').update({ email: q }).eq('member_id', rows[0].member_id)
        }
      }
    } else {
      const safe = q.replace(/[%,()]/g, '')
      const { data } = await admin.from('pilot_member').select(`${MEMBER_COLS}, auth_user_id`)
        .or(`handle.ilike.${safe}%,name.ilike.${safe}%`).eq('is_synthetic', false).limit(8)
      rows = data ?? []
    }
    // Only people who can actually sign in and accept; never herself.
    const found = rows.filter((r) => r.auth_user_id && r.member_id !== me.memberId)
    if (!found.length) return { people: [] }
    const ids = found.map((r) => r.member_id)
    const { data: ships } = await admin.from('member_friendship').select('friendship_id, requester_id, addressee_id, status')
      .or(`and(requester_id.eq.${me.memberId},addressee_id.in.(${ids.join(',')})),and(addressee_id.eq.${me.memberId},requester_id.in.(${ids.join(',')}))`)
      .neq('status', 'declined')
    const people: FoundPerson[] = found.map((r) => {
      const s = ((ships ?? []) as any[]).find((x) => x.requester_id === r.member_id || x.addressee_id === r.member_id)
      const relationship: FoundPerson['relationship'] = !s ? 'none' : s.status === 'accepted' ? 'friends' : s.requester_id === me.memberId ? 'asked' : 'asked_you'
      return { ...asFriend(r), relationship, friendship_id: s?.friendship_id }
    })
    return { people }
  } catch (err) {
    return { people: [], error: err instanceof Error ? err.message : 'Could not search' }
  }
}

/** Ask someone to be friends. She has to accept on her side before anything is shared. */
export async function askToBeFriends(memberId: string, asMemberId?: string): Promise<{ ok?: true; error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { error: 'Not signed in' }
  if (me.test) return { error: NOT_SENT }
  if (!memberId || memberId === me.memberId) return { error: 'That is you' }
  const admin = createAdminClient() as any
  try {
    const { data: other } = await admin.from('pilot_member').select('member_id, name, auth_user_id').eq('member_id', memberId).maybeSingle()
    if (!other?.auth_user_id) return { error: 'She is not on MYRA yet' }
    const { data: existing } = await admin.from('member_friendship').select('friendship_id, status, requester_id')
      .or(`and(requester_id.eq.${me.memberId},addressee_id.eq.${memberId}),and(requester_id.eq.${memberId},addressee_id.eq.${me.memberId})`)
      .maybeSingle()
    if (existing?.status === 'accepted') return { error: 'You are already friends' }
    if (existing?.status === 'pending') return existing.requester_id === me.memberId ? { error: 'Already asked — waiting for her' } : { error: 'She has already asked you — accept it instead' }
    if (existing) {
      // Declined before: ask again, from her this time.
      const { error } = await admin.from('member_friendship').update({ requester_id: me.memberId, addressee_id: memberId, status: 'pending', created_at: new Date().toISOString(), responded_at: null }).eq('friendship_id', existing.friendship_id)
      if (error) return { error: error.message }
    } else {
      const { error } = await admin.from('member_friendship').insert({ requester_id: me.memberId, addressee_id: memberId })
      if (error) return { error: error.message }
    }
    await admin.from('pilot_notification').insert({ member_id: memberId, kind: 'share', body: `${firstNameOf(me.name)} would like to share outfits with you on MYRA.`, look_ids: [] })
    return { ok: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not ask' }
  }
}

/** Her answer to someone who asked. Yes makes the friendship, and a chat for the two of them. */
export async function answerFriendRequest(friendshipId: string, accept: boolean, asMemberId?: string): Promise<{ ok?: true; chatId?: string; error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { error: 'Not signed in' }
  if (me.test) return { error: NOT_SENT }
  const admin = createAdminClient() as any
  try {
    const { data: s } = await admin.from('member_friendship').select('friendship_id, requester_id, addressee_id, status').eq('friendship_id', friendshipId).maybeSingle()
    if (!s || s.addressee_id !== me.memberId) return { error: 'Not yours to answer' }
    if (s.status !== 'pending') return { error: 'Already answered' }
    const { error } = await admin.from('member_friendship').update({ status: accept ? 'accepted' : 'declined', responded_at: new Date().toISOString() }).eq('friendship_id', friendshipId)
    if (error) return { error: error.message }
    if (!accept) return { ok: true }
    const chatId = await directChat(admin, me.memberId, s.requester_id, true)
    await admin.from('pilot_notification').insert({ member_id: s.requester_id, kind: 'share', body: `${firstNameOf(me.name)} said yes — you can share outfits now.`, look_ids: [] })
    return { ok: true, chatId: chatId ?? undefined }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not answer' }
  }
}

/** Take back an ask she made, or end a friendship. The chat stays, read-only in effect: no new messages between non-friends. */
export async function unfriend(memberId: string, asMemberId?: string): Promise<{ ok?: true; error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { error: 'Not signed in' }
  if (me.test) return { error: NOT_SENT }
  const admin = createAdminClient() as any
  const { error } = await admin.from('member_friendship').delete()
    .or(`and(requester_id.eq.${me.memberId},addressee_id.eq.${memberId}),and(requester_id.eq.${memberId},addressee_id.eq.${me.memberId})`)
  return error ? { error: error.message } : { ok: true }
}

/** Her handle — what friends type to find her. */
export async function setMyHandle(handle: string, asMemberId?: string): Promise<{ ok?: true; handle?: string; error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { error: 'Not signed in' }
  if (me.test) return { error: NOT_SENT }
  const h = (handle ?? '').trim().toLowerCase().replace(/^@/, '')
  if (!HANDLE_RE.test(h)) return { error: 'Letters, numbers, dots or underscores — 2 to 30 of them' }
  const admin = createAdminClient() as any
  const { data: taken } = await admin.from('pilot_member').select('member_id').ilike('handle', h).neq('member_id', me.memberId).maybeSingle()
  if (taken) return { error: 'Someone has that one already' }
  const { error } = await admin.from('pilot_member').update({ handle: h }).eq('member_id', me.memberId)
  return error ? { error: error.message } : { ok: true, handle: h }
}

// ── Chats ───────────────────────────────────────────────────────────────────

/** The chat for two people, made if `create` and there is none yet. */
async function directChat(admin: any, a: string, b: string, create: boolean): Promise<string | null> {
  const { data: mine } = await admin.from('share_chat_member').select('chat_id').eq('member_id', a)
  const ids = ((mine ?? []) as any[]).map((m) => m.chat_id)
  if (ids.length) {
    const { data: shared } = await admin.from('share_chat_member').select('chat_id, share_chat!inner(is_group)').eq('member_id', b).in('chat_id', ids)
    const direct = ((shared ?? []) as any[]).find((s) => s.share_chat && !s.share_chat.is_group)
    if (direct) return direct.chat_id
  }
  if (!create) return null
  const { data: chat, error } = await admin.from('share_chat').insert({ created_by: a, is_group: false }).select('chat_id').single()
  if (error || !chat) return null
  await admin.from('share_chat_member').insert([{ chat_id: chat.chat_id, member_id: a }, { chat_id: chat.chat_id, member_id: b }])
  return chat.chat_id
}

async function areFriends(admin: any, a: string, b: string): Promise<boolean> {
  const { data } = await admin.from('member_friendship').select('friendship_id')
    .or(`and(requester_id.eq.${a},addressee_id.eq.${b}),and(requester_id.eq.${b},addressee_id.eq.${a})`).eq('status', 'accepted').maybeSingle()
  return !!data
}

async function inChat(admin: any, chatId: string, memberId: string): Promise<boolean> {
  const { data } = await admin.from('share_chat_member').select('chat_id').eq('chat_id', chatId).eq('member_id', memberId).maybeSingle()
  return !!data
}

/** A group chat with two or more friends. */
export async function startGroupChat(memberIds: string[], title: string | null, asMemberId?: string): Promise<{ chatId?: string; error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { error: 'Not signed in' }
  if (me.test) return { error: NOT_SENT }
  const ids = Array.from(new Set((memberIds ?? []).filter((id) => id && id !== me.memberId)))
  if (ids.length < 2) return { error: 'Pick two or more friends for a group' }
  const admin = createAdminClient() as any
  try {
    for (const id of ids) if (!(await areFriends(admin, me.memberId, id))) return { error: 'Everyone in a group has to be your friend first' }
    const { data: chat, error } = await admin.from('share_chat').insert({ created_by: me.memberId, is_group: true, title: (title ?? '').trim().slice(0, 60) || null }).select('chat_id').single()
    if (error || !chat) return { error: error?.message ?? 'Could not start the chat' }
    await admin.from('share_chat_member').insert([me.memberId, ...ids].map((id) => ({ chat_id: chat.chat_id, member_id: id })))
    return { chatId: chat.chat_id }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not start the chat' }
  }
}

/** The messages in one chat, oldest first. Opening it is reading it. */
export async function loadChat(chatId: string, asMemberId?: string): Promise<{ messages: ShareMessage[]; error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { messages: [], error: 'Not signed in' }
  const admin = createAdminClient() as any
  try {
    if (!(await inChat(admin, chatId, me.memberId))) return { messages: [], error: 'Not your chat' }
    const [{ data: rows }, { data: members }] = await Promise.all([
      admin.from('share_message').select('*').eq('chat_id', chatId).order('created_at', { ascending: false }).limit(120),
      admin.from('share_chat_member').select('member_id, pilot_member!inner(name)').eq('chat_id', chatId),
    ])
    const names = new Map<string, string>(((members ?? []) as any[]).map((m) => [m.member_id, m.pilot_member?.name ?? 'A friend']))
    if (!me.test) await admin.from('share_chat_member').update({ last_read_at: new Date().toISOString() }).eq('chat_id', chatId).eq('member_id', me.memberId)
    const messages = ((rows ?? []) as any[]).reverse().map((m): ShareMessage => ({
      message_id: m.message_id, chat_id: m.chat_id, sender_id: m.sender_id,
      sender_name: m.sender_id === me.memberId ? 'You' : firstNameOf(names.get(m.sender_id) ?? 'A friend'),
      mine: m.sender_id === me.memberId, kind: m.kind, body: m.body ?? '', payload: (m.payload ?? null) as ShareAttachment | null, created_at: m.created_at,
    }))
    return { messages }
  } catch (err) {
    return { messages: [], error: err instanceof Error ? err.message : 'Could not open the chat' }
  }
}

function cleanAttachment(a: ShareAttachment | null | undefined): ShareAttachment | null {
  if (!a) return null
  if (a.kind === 'look') {
    const items = (a.items ?? []).slice(0, 8).map((it) => ({
      brand: String(it.brand ?? ''), product_name: String(it.product_name ?? ''), image_url: it.image_url ?? null,
      url: it.url ?? null, price_gbp: typeof it.price_gbp === 'number' ? it.price_gbp : null, item_id: it.item_id ?? null,
    }))
    if (!items.length && !a.image_url) return null
    return { kind: 'look', look_id: a.look_id ?? null, image_url: a.image_url ?? null, occasion_label: a.occasion_label ?? null, items }
  }
  if (a.kind === 'piece') {
    if (!a.product_name) return null
    return { kind: 'piece', item_id: a.item_id ?? null, brand: a.brand ?? null, product_name: String(a.product_name), image_url: a.image_url ?? null, url: a.url ?? null, price_gbp: typeof a.price_gbp === 'number' ? a.price_gbp : null }
  }
  if (a.kind === 'link') {
    const url = String(a.url ?? '').trim()
    if (!/^https?:\/\//i.test(url)) return null
    return { kind: 'link', url, title: a.title ?? null, image_url: a.image_url ?? null }
  }
  return null
}

async function post(admin: any, me: { memberId: string; name: string }, chatId: string, body: string, attachment: ShareAttachment | null): Promise<{ message?: ShareMessage; error?: string }> {
  const kind = attachment?.kind ?? 'text'
  const { data: m, error } = await admin.from('share_message').insert({ chat_id: chatId, sender_id: me.memberId, kind, body, payload: attachment }).select('*').single()
  if (error || !m) return { error: error?.message ?? 'Could not send' }
  await admin.from('share_chat').update({ last_message_at: m.created_at }).eq('chat_id', chatId)
  await admin.from('share_chat_member').update({ last_read_at: m.created_at }).eq('chat_id', chatId).eq('member_id', me.memberId)
  // A note to everyone else in the chat.
  const { data: others } = await admin.from('share_chat_member').select('member_id').eq('chat_id', chatId).neq('member_id', me.memberId)
  const line = describe(kind, attachment, body)
  if (others?.length) {
    await admin.from('pilot_notification').insert(((others ?? []) as any[]).map((o) => ({
      member_id: o.member_id, kind: 'share', body: `${firstNameOf(me.name)}: ${line.slice(0, 140)}`, look_ids: [],
    })))
  }
  return { message: { message_id: m.message_id, chat_id: chatId, sender_id: me.memberId, sender_name: 'You', mine: true, kind, body, payload: attachment, created_at: m.created_at } }
}

/** Say something in a chat — words, or words with an outfit, a piece or a link attached. */
export async function sendShareMessage(chatId: string, body: string, attachment?: ShareAttachment | null, asMemberId?: string): Promise<{ message?: ShareMessage; error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { error: 'Not signed in' }
  if (me.test) return { error: NOT_SENT }
  const text = (body ?? '').trim().slice(0, 2000)
  const att = cleanAttachment(attachment)
  if (!text && !att) return { error: 'Say something first' }
  const admin = createAdminClient() as any
  try {
    if (!(await inChat(admin, chatId, me.memberId))) return { error: 'Not your chat' }
    // In a direct chat the two must still be friends.
    const { data: chat } = await admin.from('share_chat').select('is_group').eq('chat_id', chatId).maybeSingle()
    if (chat && !chat.is_group) {
      const { data: other } = await admin.from('share_chat_member').select('member_id').eq('chat_id', chatId).neq('member_id', me.memberId).maybeSingle()
      if (other && !(await areFriends(admin, me.memberId, other.member_id))) return { error: 'You are not friends any more' }
    }
    return await post(admin, me, chatId, text, att)
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not send' }
  }
}

/**
 * Share something with friends from anywhere in MYRA — one of her looks, a
 * piece she found, a link — with a note. Each friend gets it in the chat the
 * two of them share (made if there is none yet).
 */
export async function shareWithFriends(memberIds: string[], body: string, attachment: ShareAttachment, asMemberId?: string): Promise<{ shared?: number; error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { error: 'Not signed in' }
  if (me.test) return { error: NOT_SENT }
  const ids = Array.from(new Set((memberIds ?? []).filter((id) => id && id !== me.memberId)))
  if (!ids.length) return { error: 'Pick a friend first' }
  const att = cleanAttachment(attachment)
  if (!att) return { error: 'Nothing to share' }
  const text = (body ?? '').trim().slice(0, 2000)
  const admin = createAdminClient() as any
  try {
    let shared = 0
    for (const id of ids) {
      if (!(await areFriends(admin, me.memberId, id))) continue
      const chatId = await directChat(admin, me.memberId, id, true)
      if (!chatId) continue
      const r = await post(admin, me, chatId, text, att)
      if (!r.error) shared++
    }
    if (!shared) return { error: 'Only friends who have accepted can be shared with' }
    return { shared }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not share' }
  }
}
