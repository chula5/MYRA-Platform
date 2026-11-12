import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

// Top-level routes that must never be treated as a referral code.
const RESERVED_SEGMENTS = new Set([
  'actions', 'admin', 'api', 'earlyaccess', 'edit', 'signin', 'reset-password', 'feed', 'login', 'me', 'onboarding', 'outfit', 'privacy', 'studio',
  'picks', 'press',
  // OAuth / MCP discovery names a connector probes when a server publishes no
  // auth metadata. They must 404: a 200 landing page here reads as a sign-in
  // page and fails Claude's "no sign-in" connector check. (`.well-known` never
  // reaches the rewrite: the segment test already excludes dots.)
  'register', 'authorize', 'token', 'oauth', 'oauth2', 'revoke', 'introspect', 'userinfo', 'jwks',
  'mcp', 'sse', 'well-known',
])

// A referral link is a person (or a link-preview crawler) opening a page: a GET
// or HEAD that does not ask for JSON or an event stream. Machine probes (POST
// /register, Accept: application/json, text/event-stream) never get the landing page.
function wantsPage(request: NextRequest): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false
  const accept = (request.headers.get('accept') ?? '').toLowerCase()
  if (accept.includes('text/html')) return true
  return !accept.includes('application/json') && !accept.includes('text/event-stream')
}

export async function middleware(request: NextRequest) {
  // Supabase password-recovery links land on the Site URL (/) with a one-time
  // ?code — forward those to the reset-password page so the user can set a new
  // password (covers cases where the exact redirect URL isn't allow-listed).
  if (request.nextUrl.pathname === '/' && request.nextUrl.searchParams.has('code')) {
    const url = request.nextUrl.clone()
    url.pathname = '/reset-password'
    return NextResponse.redirect(url)
  }

  // Pretty referral links: /tdfb → serve the landing page with ?ref=tdfb, while
  // the browser URL stays the clean /tdfb. Only a single, file-less, non-reserved
  // segment qualifies.
  const seg = request.nextUrl.pathname.slice(1)
  if (
    seg &&
    wantsPage(request) &&
    !seg.includes('/') &&
    !seg.includes('.') &&
    /^[a-z0-9_-]{2,30}$/i.test(seg) &&
    !RESERVED_SEGMENTS.has(seg.toLowerCase()) &&
    !request.nextUrl.searchParams.has('ref')
  ) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    url.searchParams.set('ref', seg.toLowerCase())
    return NextResponse.rewrite(url)
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refresh session — required for Server Components to pick up auth state
  await supabase.auth.getUser()

  return supabaseResponse
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * - public folder assets
     */
    '/((?!_next/static|_next/image|favicon.ico|fonts/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
