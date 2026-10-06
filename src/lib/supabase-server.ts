import { createServerClient as createSSRServerClient, type CookieOptions } from '@supabase/ssr'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { cache } from 'react'

// React's per-request cache exists in the React that Next ships; a plain
// `react` (vitest, scripts) has none, and there a call is simply uncached.
const perRequest: <F extends (...args: never[]) => unknown>(fn: F) => F =
  typeof cache === 'function' ? cache : (fn) => fn
import type { Database } from '@/types/database'

/** Anything on the auth client that can change who is signed in. After one of
 *  these the remembered answer to getUser() is thrown away. */
const AUTH_MUTATIONS = [
  'signInWithPassword', 'signInWithOtp', 'signInWithOAuth', 'signInWithIdToken', 'signUp', 'signOut',
  'setSession', 'exchangeCodeForSession', 'verifyOtp', 'updateUser', 'refreshSession',
] as const

// ── Server client (use in Server Components + Route Handlers) ──
//
// ONE PER REQUEST. A page of hers used to ask Supabase "who is this?" five
// times before it drew anything — the layout, the page, the member lookup,
// the loader, each on its own client, each a network round-trip to the auth
// server, one after the other. React's cache() hands every caller in the same
// request the same client, and that client answers getUser() from memory after
// the first time. Outside a request (a cron, a script) cache() is a no-op and
// this behaves exactly as before.
export const createServerClient = perRequest(async () => {
  const cookieStore = await cookies()

  const client = createSSRServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Server Component — cookies can't be set from here
          }
        },
      },
    }
  )

  const auth = client.auth as any
  const getUser = auth.getUser.bind(auth)
  let remembered: Promise<any> | null = null
  auth.getUser = (jwt?: string) => {
    if (jwt) return getUser(jwt)
    if (!remembered) remembered = getUser()
    return remembered
  }
  for (const name of AUTH_MUTATIONS) {
    const orig = auth[name]?.bind(auth)
    if (!orig) continue
    auth[name] = async (...args: unknown[]) => {
      remembered = null
      try { return await orig(...args) } finally { remembered = null }
    }
  }

  return client
})

// ── Admin/service role client (server-side only) ───────────────
export function createAdminClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      // Never let Next.js's fetch cache answer a database read: it served her
      // wardrobe as it stood weeks ago (4 pieces when she had 14).
      global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
    }
  )
}
