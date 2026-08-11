import { NextResponse } from 'next/server';
import { setConnection } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const base = () => process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3100';

export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get('code');
  const appId = process.env.INSTAGRAM_APP_ID;
  const appSecret = process.env.INSTAGRAM_APP_SECRET;
  const redirect = process.env.INSTAGRAM_REDIRECT_URI;

  if (!code || !appId || !appSecret || !redirect) {
    return NextResponse.redirect(new URL('/connect?ig=failed', base()));
  }

  try {
    const res = await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        grant_type: 'authorization_code',
        redirect_uri: redirect,
        code,
      }),
    });

    if (!res.ok) return NextResponse.redirect(new URL('/connect?ig=failed', base()));

    const data = (await res.json()) as { access_token?: string; user_id?: string | number };
    if (!data.access_token) {
      return NextResponse.redirect(new URL('/connect?ig=failed', base()));
    }

    setConnection('instagram', true, data.access_token, String(data.user_id ?? ''));
    return NextResponse.redirect(new URL('/connect?ig=connected', base()));
  } catch {
    return NextResponse.redirect(new URL('/connect?ig=failed', base()));
  }
}
