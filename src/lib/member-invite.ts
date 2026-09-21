// A member's invite — the link Chloe sends so a client can make her own login
// and land in the area that is already hers. Stateless: the link names the
// member and an expiry, signed; it stops working the moment she has a login
// (pilot_member.auth_user_id is set), so it is single-use without a table.
//
// Format: i1~<member_id>~<exp unix seconds>~<sig>

import 'server-only'
import crypto from 'node:crypto'

const secret = () => process.env.MEMBER_INVITE_SECRET || process.env.EMAIL_SECRET_ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const sign = (body: string) => crypto.createHmac('sha256', secret()).update(body).digest('hex').slice(0, 40)

export const INVITE_DAYS = 14

export function mintInvite(memberId: string, days = INVITE_DAYS): string {
  const exp = Math.floor(Date.now() / 1000) + days * 86_400
  const body = `i1~${memberId}~${exp}`
  return `${body}~${sign(body)}`
}

export function readInvite(token: string | null | undefined): { memberId: string; exp: number } | null {
  if (!token) return null
  const parts = decodeURIComponent(token).split('~')
  if (parts.length !== 4 || parts[0] !== 'i1') return null
  const [, memberId, expStr, sig] = parts
  const exp = Number(expStr)
  if (!/^[0-9a-f-]{36}$/i.test(memberId) || !Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(sign(`i1~${memberId}~${exp}`), 'hex'))) return null
  } catch { return null }
  return { memberId, exp }
}

// ── The short form she is sent: /join/alison-g3k9f2a1c07b ────────────────────
// Her first name, the day it runs out (base 36) and a 10-character signature.
// Still stateless: the name narrows the members to check, the signature
// proves which one. Same expiry and same single use as the long form.

const DAY = 86_400
export const nameSlug = (name: string) => ((name ?? '').trim().split(/\s+/)[0] ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z]/g, '') || 'hello'
const shortSig = (memberId: string, day: number) => crypto.createHmac('sha256', secret()).update(`j1~${memberId}~${day}`).digest('hex').slice(0, 10)

export function mintShortInvite(memberId: string, name: string, days = INVITE_DAYS): string {
  const day = Math.floor(Date.now() / 1000 / DAY) + days
  return `${nameSlug(name)}-${day.toString(36)}${shortSig(memberId, day)}`
}

/** Which of these members the short code belongs to, if it is genuine and in date. */
export function readShortInvite(code: string, members: { member_id: string; name: string }[]): string | null {
  const m = /^([a-z]+)-([0-9a-z]+)([0-9a-f]{10})$/.exec((code ?? '').toLowerCase())
  if (!m) return null
  const [, slug, dayStr, sig] = m
  const day = parseInt(dayStr, 36)
  if (!Number.isFinite(day) || day * DAY < Math.floor(Date.now() / 1000)) return null
  for (const mem of members) {
    if (nameSlug(mem.name) !== slug) continue
    try {
      if (crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(shortSig(mem.member_id, day), 'hex'))) return mem.member_id
    } catch { /* wrong length */ }
  }
  return null
}
