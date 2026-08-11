import { NextResponse } from 'next/server';
import { saveVoice, setConnection } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = (await req.json()) as Record<string, unknown>;
  saveVoice({
    my_business_description: String(body.my_business_description ?? '').slice(0, 2000),
    my_tone_of_voice: String(body.my_tone_of_voice ?? '').slice(0, 2000),
    my_offer: String(body.my_offer ?? '').slice(0, 2000),
  });
  return NextResponse.json({ ok: true });
}

/** The Photo album toggle on /connect. Instagram has its own OAuth route. */
export async function PATCH(req: Request) {
  const { photos } = (await req.json()) as { photos?: boolean };
  if (typeof photos === 'boolean') setConnection('photos', photos);
  return NextResponse.json({ ok: true });
}
