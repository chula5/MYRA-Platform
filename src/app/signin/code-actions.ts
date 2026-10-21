'use server'

// THE DOOR, EMAIL FIRST.
//
// A member types the email Chloe has for her. If it is on the list she is sent
// a one-time code (Supabase email OTP — a code she types in the app, never a
// link, because a link opens in Safari and not in the app's web view). The
// code signs her in; on her very first sign-in she then makes a password, and
// from then on email + password works as it always did, or the code again.
//
// Every export here is public. Nothing is said about an email beyond what the
// flow needs: it is on the list (a code is on its way) or it is not (apply).
// Who the email belongs to is decided by public.member_for_sign_in (migration
// 0102), which only the service role can call.

import { createAdminClient, createServerClient } from '@/lib/supabase-server'
import { recordEarlyAccessLogin } from '@/app/earlyaccess/activity'
import { recordSignOn } from '@/lib/sign-on'

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const NOT_LISTED = "That email isn't on our list yet. APPLY and we'll come back to you."
const NOT_READY = 'Codes are not switched on yet — sign in with your password.'

type Door = { member_id: string; name: string; auth_user_id: string | null; user_id: string | null; has_password: boolean }

type Lookup = { door: Door | null } | { notReady: true }

async function whoIs(email: string): Promise<Lookup> {
  const admin = createAdminClient() as any
  const { data, error } = await admin.rpc('member_for_sign_in', { p_email: email })
  if (error) {
    // The function arrives with 0102; until it is applied the door says so
    // rather than telling everyone they are not on the list.
    if (/does not exist|schema cache|not find/i.test(error.message)) return { notReady: true }
    throw new Error(error.message)
  }
  const row = (Array.isArray(data) ? data[0] : data) as Door | undefined
  return { door: row ?? null }
}

export type CodeRequest = { ok: true; email: string } | { ok: false; message: string }

/** Step one: her email. A code goes out if it is on the list. */
export async function requestSignInCode(input: { email: string }): Promise<CodeRequest> {
  const email = String(input?.email ?? '').trim().toLowerCase()
  if (!EMAIL_RE.test(email)) return { ok: false, message: 'Enter a valid email address' }

  let found: Lookup
  try { found = await whoIs(email) } catch {
    await recordSignOn({ step: 'code_refused', ok: false, email, detail: 'could not check the email' })
    return { ok: false, message: 'Could not check that email just now — please try again' }
  }
  if ('notReady' in found) {
    await recordSignOn({ step: 'code_refused', ok: false, email, detail: 'codes not switched on' })
    return { ok: false, message: NOT_READY }
  }
  // Logged with no member: an address that matches nobody is most often a
  // member typing a different one, and it shows on the JOURNEY tab as such.
  if (!found.door) {
    await recordSignOn({ step: 'code_refused', ok: false, email, detail: 'not on the list' })
    return { ok: false, message: NOT_LISTED }
  }
  const memberId = found.door.member_id

  // A member Chloe has written down but who has no login yet is created by
  // the code itself; anyone who already has a login just gets the code.
  const shouldCreateUser = !found.door.user_id
  const supabase = await createServerClient()
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser,
      data: shouldCreateUser ? { role: 'client', name: found.door.name } : undefined,
    },
  })
  if (error) {
    const limited = /rate|too many|limit/i.test(error.message)
    await recordSignOn({ step: 'code_refused', ok: false, memberId, email, detail: limited ? 'too many codes' : `send failed: ${error.message}` })
    if (limited) return { ok: false, message: 'Too many codes just now — wait a few minutes and try again' }
    return { ok: false, message: 'Could not send the code — please try again' }
  }
  await recordSignOn({ step: 'code_sent', memberId, email, detail: shouldCreateUser ? 'first code — login made by it' : null })
  return { ok: true, email }
}

export type CodeVerify = { ok: true; next: string } | { ok: false; message: string }

/** Step two: the code from her email. Signs her in and, the first time, points the login at her member record. */
export async function verifySignInCode(input: { email: string; code: string; next?: string }): Promise<CodeVerify> {
  const email = String(input?.email ?? '').trim().toLowerCase()
  const code = String(input?.code ?? '').replace(/\s+/g, '')
  if (!EMAIL_RE.test(email)) return { ok: false, message: 'Enter a valid email address' }
  if (!/^\d{6,10}$/.test(code)) return { ok: false, message: 'Enter the code from your email' }

  const supabase = await createServerClient()
  const { data, error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' })
  if (error || !data.user) {
    await recordSignOn({ step: 'code_failed', ok: false, email, detail: error?.message ?? 'no user' })
    return { ok: false, message: "That code didn't work — check it, or ask for a new one" }
  }
  const user = data.user

  // Her member record. The first time, the login is pointed at it the way the
  // invite link does: client role, her name, the email kept for sharing.
  let hasPassword = true
  try {
    const found = await whoIs(email)
    if ('door' in found && found.door) {
      const door = found.door
      hasPassword = door.has_password
      const admin = createAdminClient() as any
      if (!door.auth_user_id) {
        // Only if nobody got there first, and only if this login is not already somebody else's.
        const { data: taken } = await admin.from('pilot_member').select('member_id').eq('auth_user_id', user.id).limit(1)
        if (!taken?.length) {
          const { data: linked } = await admin.from('pilot_member')
            .update({ auth_user_id: user.id, email })
            .eq('member_id', door.member_id).is('auth_user_id', null).select('member_id')
          if (linked?.length) {
            await admin.auth.admin.updateUserById(user.id, { user_metadata: { ...(user.user_metadata ?? {}), role: 'client', name: door.name } })
            try { await admin.from('client_profile').upsert({ user_id: user.id, name: door.name, email }, { onConflict: 'user_id' }) } catch { /* optional table */ }
            // A fresh session so the client role is in it.
            await supabase.auth.refreshSession()
          }
        }
      } else if (door.auth_user_id === user.id) {
        await admin.from('pilot_member').update({ email }).eq('member_id', door.member_id).is('email', null)
      }
    }
  } catch { /* she is signed in either way; the member area resolves her from auth_user_id */ }

  await recordEarlyAccessLogin(user.id)
  await recordSignOn({ step: 'signed_in', authUserId: user.id, email, detail: hasPassword ? 'code' : 'code — first time' })

  if (!hasPassword) return { ok: true, next: 'password' }
  // Where she was on her way to, if it is one of our own pages.
  const next = String(input?.next ?? '').trim()
  if (next && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\')) return { ok: true, next }
  return { ok: true, next: '/me' }
}

export type PasswordSet = { ok: true } | { ok: false; message: string }

/** Her first sign-in: the password she will use from now on. Needs the session the code just made. */
export async function setFirstPassword(input: { password: string; confirm: string }): Promise<PasswordSet> {
  const password = String(input?.password ?? '')
  const confirm = String(input?.confirm ?? '')
  if (password.length < 8) return { ok: false, message: 'Choose a password of at least 8 characters' }
  if (password !== confirm) return { ok: false, message: 'Those passwords do not match' }

  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'Your sign-in has expired — start again with your email' }
  const { error } = await supabase.auth.updateUser({ password })
  if (error) {
    await recordSignOn({ step: 'password_failed', ok: false, authUserId: user.id, email: user.email, detail: error.message })
    return { ok: false, message: 'Could not save that password — please try again' }
  }
  await recordSignOn({ step: 'password_set', authUserId: user.id, email: user.email })
  return { ok: true }
}
