import { NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getItem, UPLOAD_DIR } from '@/lib/db';

export const runtime = 'nodejs';

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const item = getItem(params.id);
  if (!item?.image_url) return new NextResponse('Not found', { status: 404 });

  // image_url is a filename we generated from the item id; never a client path.
  const filename = path.basename(item.image_url);
  const ext = path.extname(filename).toLowerCase();
  if (!MIME[ext]) return new NextResponse('Not found', { status: 404 });

  try {
    const bytes = await fs.readFile(path.join(UPLOAD_DIR, filename));
    return new NextResponse(bytes, {
      headers: {
        'Content-Type': MIME[ext],
        'Cache-Control': 'private, max-age=31536000, immutable',
      },
    });
  } catch {
    return new NextResponse('Not found', { status: 404 });
  }
}
