import { NextResponse, type NextRequest } from 'next/server'
import { exchangeCodeForTokens } from '@/lib/canva'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')

  if (error) {
    return NextResponse.redirect(
      new URL(`/admin/canva?error=${encodeURIComponent(error)}`, req.url)
    )
  }

  if (!code) {
    return NextResponse.redirect(new URL('/admin/canva?error=no_code', req.url))
  }

  const expectedState = req.cookies.get('canva_state')?.value
  const verifier = req.cookies.get('canva_code_verifier')?.value

  if (!expectedState || state !== expectedState) {
    return NextResponse.redirect(new URL('/admin/canva?error=bad_state', req.url))
  }
  if (!verifier) {
    return NextResponse.redirect(new URL('/admin/canva?error=no_verifier', req.url))
  }

  try {
    await exchangeCodeForTokens(code, verifier)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'token_exchange_failed'
    return NextResponse.redirect(
      new URL(`/admin/canva?error=${encodeURIComponent(msg)}`, req.url)
    )
  }

  const res = NextResponse.redirect(new URL('/admin/canva?connected=1', req.url))
  res.cookies.delete('canva_state')
  res.cookies.delete('canva_code_verifier')
  return res
}
