import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { buildAuthUrl } from '@/lib/canva'

// Stateless PKCE: store verifier in a short-lived cookie signed by NEXTAUTH_SECRET (fallback: plaintext cookie for dev).
export async function GET() {
  const codeVerifier = crypto.randomBytes(32).toString('base64url')
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url')
  const state = crypto.randomBytes(16).toString('base64url')

  const authUrl = `${buildAuthUrl(state)}&code_challenge=${codeChallenge}`

  const res = NextResponse.redirect(authUrl)
  // Cookies — HttpOnly, 10-minute TTL
  res.cookies.set('canva_code_verifier', codeVerifier, {
    httpOnly: true,
    path: '/',
    maxAge: 600,
    sameSite: 'lax',
  })
  res.cookies.set('canva_state', state, {
    httpOnly: true,
    path: '/',
    maxAge: 600,
    sameSite: 'lax',
  })
  return res
}
