import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

// Top-level routes that must never be treated as a referral code.
const RESERVED_SEGMENTS = new Set([
  'actions', 'admin', 'api', 'earlyaccess', 'edit', 'signin', 'reset-password', 'feed', 'login', 'me', 'onboarding', 'outfit', 'privacy', 'studio',
  'picks',
])

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
