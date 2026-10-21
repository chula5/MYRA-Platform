// SIGNING ON — every step between Chloe's invitation and her first room.
//
// The JOURNEY tab used to start counting at /me: the tracker only runs inside
// her rooms, and it can only write once she is a signed-in member. So the
// whole door in front of those rooms was dark — the invite link opened, the
// code asked for and never typed, the password mistyped, the email that was
// not the one Chloe has. A member stuck at the door showed the same row of
// zeros as a member who never tried, and those need opposite replies.
//
// Two sources, read together:
//   · member_sign_on (0104), written here from the server side of every door
//     action — trusted, because the browser never names who is signing on.
//   · her Supabase login itself — when it was made, the last time it signed
//     in, and the welcome/tour stamps on its metadata. These predate 0104, so
//     a member who signed on before the log existed still reads truthfully.
//
// SERVER ONLY, and like client-journey: writes never throw. A sign-in that
// fails because its own analytics failed would be the worst bug on the site.

import 'server-only'
import { headers } from 'next/headers'
import { createAdminClient } from '@/lib/supabase-server'
import { isMissingTable } from '@/lib/metrics-core'

export const SIGN_ON_STEPS = [
  'invite_opened', 'invite_accepted', 'invite_failed',
  'code_requested', 'code_refused', 'code_sent', 'code_failed',
  'signed_in', 'sign_in_failed', 'password_set', 'password_failed',
  'welcomed', 'app_first_open', 'tour_done', 'signed_out',
] as const
export type SignOnStep = (typeof SIGN_ON_STEPS)[number]

export const SIGN_ON_LABEL: Record<SignOnStep, string> = {
  invite_opened: 'OPENED HER INVITE LINK',
  invite_accepted: 'MADE HER LOGIN FROM THE INVITE',
  invite_failed: 'INVITE DID NOT GO THROUGH',
  code_requested: 'ASKED FOR A CODE',
  code_refused: 'WAS NOT SENT A CODE',
  code_sent: 'WAS SENT A CODE',
  code_failed: 'CODE DID NOT WORK',
  signed_in: 'SIGNED IN',
  sign_in_failed: 'SIGN-IN DID NOT WORK',
  password_set: 'MADE HER PASSWORD',
  password_failed: 'PASSWORD NOT SAVED',
  welcomed: 'SAW HER WELCOME',
  app_first_open: 'OPENED THE IPHONE APP',
  tour_done: 'FINISHED THE TOUR',
  signed_out: 'SIGNED OUT',
}

export interface SignOnInput {
  step: SignOnStep
  ok?: boolean
  memberId?: string | null
  authUserId?: string | null
  email?: string | null
  /** A short reason or method — "code", "password", "not on the list". Never a secret. */
  detail?: string | null
}

/** iPhone app, phone browser, tablet or desktop — from the user agent alone.
 *  The app's web view drops the "Safari/" token that real Safari carries. */
export function deviceFromAgent(ua: string | null | undefined): string | null {
  if (!ua) return null
  if (/iPhone|iPad|iPod/.test(ua) && !/Safari\//.test(ua)) return 'iphone app'
  if (/iPad|Tablet/.test(ua)) return 'tablet'
  if (/Mobi|iPhone|Android/.test(ua)) return 'mobile'
  return 'desktop'
}

/** Her member row, from whichever of the three identifiers the caller has. */
async function memberFor(input: SignOnInput): Promise<string | null> {
  if (input.memberId) return input.memberId
  const admin = createAdminClient() as any
  if (input.authUserId) {
    const { data } = await admin.from('pilot_member').select('member_id').eq('auth_user_id', input.authUserId).maybeSingle()
    if (data?.member_id) return data.member_id
  }
  const email = (input.email ?? '').trim().toLowerCase()
  if (email) {
    // Two plain lookups rather than one .or() — an address is typed by her,
    // and a comma in it would be read as filter syntax.
    for (const column of ['email', 'invite_email']) {
      const { data } = await admin.from('pilot_member').select('member_id').eq(column, email).limit(1)
      if (data?.[0]?.member_id) return data[0].member_id
    }
  }
  return null
}

/** Note one step at the door. Never throws, never blocks long. */
export async function recordSignOn(input: SignOnInput): Promise<void> {
  try {
    let ua: string | null = null
    let country: string | null = null
    try {
      const h = headers()
      ua = h.get('user-agent')
      country = h.get('x-vercel-ip-country') || h.get('cf-ipcountry') || null
    } catch { /* outside a request */ }
    // Chloe's own door is not a member's. She has a member row of her own, so
    // her sign-ins would otherwise land on it — the tracker skips her too.
    const adminId = process.env.ADMIN_USER_ID
    if (adminId && input.authUserId === adminId) return
    const memberId = await memberFor(input)
    const admin = createAdminClient() as any
    if (adminId && memberId) {
      const { data: owner } = await admin.from('pilot_member').select('auth_user_id').eq('member_id', memberId).maybeSingle()
      if (owner?.auth_user_id === adminId) return
    }
    const { error } = await admin.from('member_sign_on').insert({
      member_id: memberId,
      auth_user_id: input.authUserId ?? null,
      email: input.email ? input.email.trim().toLowerCase().slice(0, 200) : null,
      step: input.step,
      ok: input.ok ?? true,
      detail: input.detail ? input.detail.slice(0, 200) : null,
      device: deviceFromAgent(ua),
      user_agent: ua?.slice(0, 400) ?? null,
      country,
    })
    if (error && !isMissingTable(error)) console.error('[sign-on]', error.message)
  } catch (err) {
    console.error('[sign-on]', err)
  }
}

// ── Reads (the JOURNEY tab) ─────────────────────────────────────────────────

export interface SignOnEvent {
  at: string
  step: SignOnStep
  label: string
  ok: boolean
  email: string | null
  detail: string | null
  device: string | null
}

export interface SignOnStatus {
  memberId: string
  name: string
  /** The email Chloe has for her — what the door will accept. */
  email: string | null
  hasLogin: boolean
  loginEmail: string | null
  loginMadeAt: string | null
  lastSignInAt: string | null
  welcomedAt: string | null
  appWelcomedAt: string | null
  touredAt: string | null
  firstVisitAt: string | null
  lastVisitAt: string | null
  /** Where she has got to, in words — the one line to read first. */
  stage: string
  /** True when she is stuck: tried and did not get in. */
  stuck: boolean
  events: SignOnEvent[]
  /** False until 0104_member_sign_on.sql has been run. */
  available: boolean
}

function stageOf(s: Omit<SignOnStatus, 'stage' | 'stuck'>): { stage: string; stuck: boolean } {
  const lastFail = s.events.find((e) => !e.ok)
  const lastOk = s.events.find((e) => e.ok && (e.step === 'signed_in' || e.step === 'invite_accepted'))
  const failedSince = lastFail && (!lastOk || lastFail.at > lastOk.at)
  if (s.lastVisitAt) {
    if (s.touredAt) return { stage: 'SIGNED ON — IN HER ROOMS', stuck: false }
    return { stage: 'IN HER ROOMS — TOUR NOT FINISHED', stuck: false }
  }
  if (failedSince) return { stage: `STUCK AT THE DOOR — ${lastFail!.label}`, stuck: true }
  if (s.events.some((e) => e.step === 'code_sent') && !s.lastSignInAt) {
    return { stage: 'SENT A CODE — HAS NOT TYPED IT IN', stuck: true }
  }
  if (s.events.some((e) => e.step === 'invite_opened') && !s.hasLogin) {
    return { stage: 'OPENED HER INVITE — NO LOGIN MADE', stuck: true }
  }
  if (s.lastSignInAt) return { stage: 'SIGNED IN — NO VISIT RECORDED', stuck: false }
  if (s.hasLogin) return { stage: 'LOGIN MADE — HAS NEVER SIGNED IN', stuck: false }
  return { stage: 'NO LOGIN YET — NOT INVITED IN', stuck: false }
}

/**
 * Where every member (or one) has got to at the door, with the steps that
 * got her there. Not windowed: signing on happens once, and a 7-day view that
 * hid the invite she opened three weeks ago would hide the whole story.
 */
export async function loadSignOn(memberId: string | null): Promise<SignOnStatus[]> {
  const admin = createAdminClient() as any
  let mq = admin.from('pilot_member')
    .select('member_id, name, email, invite_email, auth_user_id, is_synthetic')
    .order('name')
  if (memberId) mq = mq.eq('member_id', memberId)
  const { data: memberRows } = await mq
  const members = ((memberRows ?? []) as any[]).filter((m) => !m.is_synthetic)
  if (!members.length) return []
  const ids = members.map((m) => m.member_id)

  let available = true
  let rows: any[] = []
  {
    const { data, error } = await admin.from('member_sign_on')
      .select('member_id, at, step, ok, email, detail, device')
      .in('member_id', ids)
      .order('at', { ascending: false })
      .limit(1000)
    if (error) available = !isMissingTable(error)
    else rows = data ?? []
  }

  // First and last visit, all-time, from the journey's own table.
  const visits = new Map<string, { first: string; last: string }>()
  {
    const { data } = await admin.from('client_session')
      .select('member_id, started_at, last_seen_at')
      .in('member_id', ids)
      .order('started_at', { ascending: true })
      .limit(1000)
    for (const v of (data ?? []) as any[]) {
      const cur = visits.get(v.member_id)
      if (!cur) visits.set(v.member_id, { first: v.started_at, last: v.last_seen_at })
      else if (v.last_seen_at > cur.last) cur.last = v.last_seen_at
    }
  }

  return Promise.all(members.map(async (m) => {
    let user: any = null
    if (m.auth_user_id) {
      try { user = (await admin.auth.admin.getUserById(m.auth_user_id)).data?.user ?? null } catch { /* gone */ }
    }
    const meta = (user?.user_metadata ?? {}) as Record<string, any>
    const events: SignOnEvent[] = rows
      .filter((r) => r.member_id === m.member_id)
      .map((r) => ({
        at: r.at,
        step: r.step,
        label: SIGN_ON_LABEL[r.step as SignOnStep] ?? String(r.step).toUpperCase(),
        ok: Boolean(r.ok),
        email: r.email ?? null,
        detail: r.detail ?? null,
        device: r.device ?? null,
      }))
    const base = {
      memberId: m.member_id,
      name: m.name,
      email: m.email ?? m.invite_email ?? null,
      hasLogin: Boolean(m.auth_user_id),
      loginEmail: user?.email ?? null,
      loginMadeAt: user?.created_at ?? null,
      lastSignInAt: user?.last_sign_in_at ?? null,
      welcomedAt: meta.welcomed_at ?? null,
      appWelcomedAt: meta.app_welcomed_at ?? null,
      touredAt: meta.toured_at ?? null,
      firstVisitAt: visits.get(m.member_id)?.first ?? null,
      lastVisitAt: visits.get(m.member_id)?.last ?? null,
      events,
      available,
    }
    // Chloe's own member row: her browsing is never recorded, so "no visit"
    // there is by design, not a finding.
    if (m.auth_user_id && m.auth_user_id === process.env.ADMIN_USER_ID) {
      return { ...base, stage: 'THIS IS YOU — YOUR OWN VISITS ARE NEVER RECORDED', stuck: false }
    }
    return { ...base, ...stageOf(base) }
  }))
}

/** Failed door attempts with an email that matched no member — "she typed a
 *  different address" is invisible on her own row, so it is listed apart.
 *  Successes are left out: those are early-access logins, not members. */
export async function loadUnmatchedSignOn(sinceDays = 30): Promise<SignOnEvent[]> {
  try {
    const admin = createAdminClient() as any
    const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString()
    const { data, error } = await admin.from('member_sign_on')
      .select('at, step, ok, email, detail, device')
      .is('member_id', null)
      .eq('ok', false)
      .gte('at', since)
      .order('at', { ascending: false })
      .limit(50)
    if (error) return []
    return ((data ?? []) as any[]).map((r) => ({
      at: r.at,
      step: r.step,
      label: SIGN_ON_LABEL[r.step as SignOnStep] ?? String(r.step).toUpperCase(),
      ok: Boolean(r.ok),
      email: r.email ?? null,
      detail: r.detail ?? null,
      device: r.device ?? null,
    }))
  } catch {
    return []
  }
}
