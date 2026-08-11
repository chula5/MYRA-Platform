import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Instagram OAuth, honestly scoped.
 *
 * Saved posts and collections are NOT exposed to third parties. The Basic
 * Display API reached end-of-life in December 2024, and the Instagram Graph API
 * that replaced it offers /media, /stories, /tags and /mentioned_media for your
 * own Business or Creator account — there is no saved-media or collections
 * edge. Collections are a private, user-facing feature.
 *
 * So this flow is real, but all it can ever return is the account's own posts.
 * The primary Instagram path in Seen is the share sheet / manual upload.
 */
export async function GET() {
  const appId = process.env.INSTAGRAM_APP_ID;
  const redirect = process.env.INSTAGRAM_REDIRECT_URI;

  if (!appId || !redirect) {
    return NextResponse.redirect(
      new URL(
        '/connect?ig=unconfigured',
        process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3100',
      ),
    );
  }

  const url = new URL('https://www.instagram.com/oauth/authorize');
  url.searchParams.set('client_id', appId);
  url.searchParams.set('redirect_uri', redirect);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'instagram_business_basic');

  return NextResponse.redirect(url.toString());
}
