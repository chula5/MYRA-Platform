// MYRA Mirror — member identity for the browser extension.
//
// The extension never holds a Supabase session. It holds one signed, expiring
// token that names a pilot member and nothing else. Minted only on the MYRA
// origin for a signed-in member (see /mirror/connect); presented as a Bearer
// header to /api/mirror/*. HMAC pattern copied from shopify/crypto.ts — no
// JWT library, no claims beyond member id + expiry.
//
// Formats (the '~' separator never appears in a uuid, an integer or a hex sig):
//   v1~<member_id>~<exp>~<sig>                   — the member herself
//   v2~<member_id>~<actor>~<exp>~<sig>           — actor = 'self', or the admin
//     user id when Chloe is shopping AS a client (stylist mode). Only an
//     admin-actor token may hold pieces in a member's delivery or switch member.

import 'server-only'
import crypto from 'node:crypto'
import { createAdminClient } from '@/lib/supabase-server'

const secret = () => process.env.MIRROR_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || ''

/** Phase 0: 30 days. Re-connecting from /mirror/connect refreshes it. */
export const MIRROR_TOKEN_TTL_S = 30 * 24 * 3600

function sign(body: string): string {
  return crypto.createHmac('sha256', secret()).update(body).digest('hex').slice(0, 32)
}

export interface MirrorClaims { memberId: string; actor: 'self' | string; exp: number }

export function mintMirrorToken(memberId: string, opts: { ttlS?: number; actor?: string | null } = {}): string {
  const exp = Math.floor(Date.now() / 1000) + (opts.ttlS ?? MIRROR_TOKEN_TTL_S)
  const actor = opts.actor && opts.actor !== 'self' ? opts.actor : 'self'
  const body = `v2~${memberId}~${actor}~${exp}`
  return `${body}~${sign(body)}`
}

const UUID = /^[0-9a-f-]{36}$/i

export function resolveMirrorToken(token: string | null | undefined): MirrorClaims | null {
  if (!token) return null
  const parts = token.split('~')
  let memberId: string, actor: string, expStr: string, sig: string, body: string
  if (parts.length === 4 && parts[0] === 'v1') {
    ;[, memberId, expStr, sig] = parts; actor = 'self'; body = `v1~${memberId}~${expStr}`
  } else if (parts.length === 5 && parts[0] === 'v2') {
    ;[, memberId, actor, expStr, sig] = parts; body = `v2~${memberId}~${actor}~${expStr}`
  } else return null
  const exp = Number(expStr)
  if (!UUID.test(memberId) || !Number.isFinite(exp)) return null
  if (actor !== 'self' && !UUID.test(actor)) return null
  if (exp < Math.floor(Date.now() / 1000)) return null
  const expected = sign(body)
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) return null
  } catch { return null }
  return { memberId, actor, exp }
}

export interface MirrorMember {
  member_id: string
  name: string
  auth_user_id: string | null
  brands: Array<{ name: string; rank: number }>
  brands_input_only: string[]
  sizes: Record<string, string>
  /** Chloe shopping AS this member (stylist mode). Gates hold / switch / members. */
  actingAdmin: boolean
  actorUserId: string | null
}

/** Bearer token on the request → the member it names, or null. */
export async function memberFromRequest(req: Request): Promise<MirrorMember | null> {
  const auth = req.headers.get('authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null
  const claim = resolveMirrorToken(token)
  if (!claim) return null
  const admin = createAdminClient() as any
  const { data } = await admin.from('pilot_member')
    .select('member_id, name, auth_user_id, brands, brands_input_only, sizes')
    .eq('member_id', claim.memberId).maybeSingle()
  if (!data) return null
  return {
    member_id: data.member_id,
    name: data.name,
    auth_user_id: data.auth_user_id ?? null,
    brands: Array.isArray(data.brands) ? data.brands : [],
    brands_input_only: data.brands_input_only ?? [],
    sizes: data.sizes ?? {},
    actingAdmin: claim.actor !== 'self' && !!process.env.ADMIN_USER_ID && claim.actor === process.env.ADMIN_USER_ID,
    actorUserId: claim.actor === 'self' ? null : claim.actor,
  }
}

/** The admin-only door: a member resolved from an admin-actor token, or null (→ 403). */
export async function adminFromRequest(req: Request): Promise<MirrorMember | null> {
  const m = await memberFromRequest(req)
  return m?.actingAdmin ? m : null
}
