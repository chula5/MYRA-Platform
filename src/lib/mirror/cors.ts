// /api/mirror/* is called from the extension's background worker (extension
// origin) and, in dev, from a content script running under the brand site's
// origin. Auth is a Bearer token, never a cookie, so a wildcard origin leaks
// nothing: a page can only get a member's data by already holding her token.

import { NextResponse } from 'next/server'

export const MIRROR_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
}

export function mirrorJson(body: unknown, init: ResponseInit = {}): NextResponse {
  const res = NextResponse.json(body, init)
  for (const [k, v] of Object.entries(MIRROR_CORS_HEADERS)) res.headers.set(k, v)
  return res
}

export function mirrorOptions(): NextResponse {
  return new NextResponse(null, { status: 204, headers: MIRROR_CORS_HEADERS })
}
