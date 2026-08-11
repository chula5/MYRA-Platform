import { NextResponse } from 'next/server';
import { createItem, getSettings } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface IgMedia {
  id: string;
  caption?: string;
  media_url?: string;
  permalink?: string;
  media_type?: string;
  timestamp?: string;
}

/**
 * Pulls what the API actually permits: the connected account's OWN media.
 *
 * This is NOT the user's saved posts. There is no endpoint for those — see
 * ../auth/route.ts. Anything that claims otherwise is scraping.
 */
export async function GET() {
  const settings = getSettings();
  if (!settings.instagram_connected || !settings.instagram_token) {
    return NextResponse.json({ error: 'Instagram is not connected.' }, { status: 400 });
  }

  try {
    const url = new URL('https://graph.instagram.com/v23.0/me/media');
    url.searchParams.set('fields', 'id,caption,media_url,permalink,media_type,timestamp');
    url.searchParams.set('limit', '50');
    url.searchParams.set('access_token', settings.instagram_token);

    const res = await fetch(url.toString());
    if (!res.ok) {
      const detail = await res.text();
      return NextResponse.json(
        { error: 'Instagram rejected the request.', detail: detail.slice(0, 300) },
        { status: 502 },
      );
    }

    const { data = [] } = (await res.json()) as { data?: IgMedia[] };

    let created = 0;
    for (const media of data) {
      if (!media.caption?.trim()) continue;
      createItem({
        source: 'instagram',
        image_url: null,
        captured_at: media.timestamp ?? null,
        extracted_text: [media.caption.trim(), media.permalink].filter(Boolean).join('\n\n'),
        bucket: 'inspiration',
      });
      created++;
    }

    return NextResponse.json({
      created,
      scanned: data.length,
      note: 'These are your own posts. Instagram does not expose saved posts to third parties.',
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
