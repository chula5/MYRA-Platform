// The admin gate for ROUTE HANDLERS, remembered.
//
// Every admin route checked the session against Supabase Auth on every
// request (createServerClient + auth.getUser is a network round trip): the
// Outfit Review picker fired one per keystroke and waited on each. The same
// cookie is the same session, so one successful check is remembered for a
// few minutes, keyed by a hash of the cookie header. A refused check is not
// remembered (a sign-in should take effect at once).

import 'server-only'
import { createHash } from 'crypto'
import { headers } from 'next/headers'
import { createServerClient } from '@/lib/supabase-server'

const REMEMBER_MS = 5 * 60_000
const remembered = new Map<string, number>()

export async function isAdminRequest(): Promise<boolean> {
  let key: string | null = null
  try {
    const cookie = (await headers()).get('cookie') ?? ''
    if (cookie) key = createHash('sha256').update(cookie).digest('hex')
  } catch { /* outside a request: check every time */ }
  if (key) {
    const until = remembered.get(key)
    if (until && until > Date.now()) return true
  }
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const ok = !!user && user.id === process.env.ADMIN_USER_ID
  if (ok && key) {
    remembered.set(key, Date.now() + REMEMBER_MS)
    if (remembered.size > 200) for (const [k, v] of remembered) if (v < Date.now()) remembered.delete(k)
  }
  return ok
}
