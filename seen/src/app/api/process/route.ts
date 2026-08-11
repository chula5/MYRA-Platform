import { NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import { itemsAwaitingExtraction, updateItem, UPLOAD_DIR } from '@/lib/db';
import { extractAndClassify, isSupportedImage, mapLimit } from '@/lib/anthropic';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Processed per request, so the client can show honest progress. */
const SLICE = 8;
const CONCURRENCY = 4;

const MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
};

export async function POST() {
  const pending = itemsAwaitingExtraction();
  const slice = pending.slice(0, SLICE);

  const results = await mapLimit(slice, CONCURRENCY, async (item) => {
    try {
      if (!item.image_url) {
        // Manual text entry: nothing to look at, so it is a note by definition.
        updateItem(item.id, { bucket: 'notes' });
        return { ok: true };
      }

      const ext = path.extname(item.image_url).slice(1).toLowerCase();
      const mediaType = MIME[ext];
      if (!mediaType || !isSupportedImage(mediaType)) {
        return { ok: false, error: `Unreadable file type: .${ext}` };
      }

      const bytes = await fs.readFile(path.join(UPLOAD_DIR, item.image_url));
      const { bucket, extracted_text } = await extractAndClassify({
        base64: bytes.toString('base64'),
        mediaType,
      });

      updateItem(item.id, { bucket, extracted_text });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  const failures = results.filter((r) => !r.ok);

  return NextResponse.json({
    processed: results.length - failures.length,
    failed: failures.length,
    errors: failures.slice(0, 3).map((f) => ('error' in f ? f.error : 'unknown')),
    // Recomputed after the writes above, so a stuck item doesn't loop forever
    // — a failed item keeps bucket NULL, so the client stops when a pass
    // makes no progress.
    remaining: Math.max(0, itemsAwaitingExtraction().length),
  });
}
