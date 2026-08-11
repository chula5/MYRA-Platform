import { NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createItem, UPLOAD_DIR, setConnection } from '@/lib/db';
import { isSupportedImage, SUPPORTED_IMAGE_TYPES } from '@/lib/anthropic';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

export async function POST(req: Request) {
  const form = await req.formData();
  const files = form.getAll('files').filter((f): f is File => f instanceof File);

  if (!files.length) {
    return NextResponse.json({ error: 'No files received.' }, { status: 400 });
  }

  await fs.mkdir(UPLOAD_DIR, { recursive: true });

  const created: string[] = [];
  const skipped: { name: string; reason: string }[] = [];

  for (const file of files) {
    if (!isSupportedImage(file.type)) {
      skipped.push({
        name: file.name,
        reason: file.type
          ? `${file.type} isn't readable by the model`
          : "couldn't tell what kind of file this is",
      });
      continue;
    }

    const item = createItem({
      source: 'photos',
      image_url: null,
      // The camera roll's own timestamp — this is what makes "4 months ago" true.
      captured_at: file.lastModified ? new Date(file.lastModified).toISOString() : null,
    });

    const filename = `${item.id}.${EXT[file.type]}`;
    await fs.writeFile(
      path.join(UPLOAD_DIR, filename),
      Buffer.from(await file.arrayBuffer()),
    );

    const { db } = await import('@/lib/db');
    db().prepare(`UPDATE items SET image_url = ? WHERE id = ?`).run(filename, item.id);
    created.push(item.id);
  }

  if (created.length) setConnection('photos', true);

  return NextResponse.json({
    created: created.length,
    skipped,
    supported: SUPPORTED_IMAGE_TYPES,
  });
}
