import { NextResponse } from 'next/server';
import { createDraft, getSettings, itemsAwaitingDraft } from '@/lib/db';
import { DRAFT_BATCH_SIZE, DRAFT_TYPE, draftBatch } from '@/lib/anthropic';
import type { Bucket, Item } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * One request handles one batch: up to DRAFT_BATCH_SIZE items of a single
 * bucket go into a single model call. The client loops until remaining is 0.
 */
export async function POST() {
  const pending = itemsAwaitingDraft();
  if (!pending.length) {
    return NextResponse.json({ drafted: 0, failed: 0, remaining: 0 });
  }

  // All items in a call must share a bucket — each bucket has its own brief.
  const bucket = pending[0].bucket as Bucket;
  const batch: Item[] = pending
    .filter((i) => i.bucket === bucket)
    .slice(0, DRAFT_BATCH_SIZE);

  try {
    const settings = getSettings();
    const drafts = await draftBatch(bucket, batch, settings);

    for (const [itemId, text] of drafts) {
      createDraft({ item_id: itemId, draft_text: text, draft_type: DRAFT_TYPE[bucket] });
    }

    const remaining = itemsAwaitingDraft().length;
    return NextResponse.json({
      drafted: drafts.size,
      failed: batch.length - drafts.size,
      bucket,
      remaining,
      // If the model returned nothing for this batch, another identical pass
      // will do the same. Tell the client to stop.
      stalled: drafts.size === 0,
    });
  } catch (err) {
    return NextResponse.json(
      {
        drafted: 0,
        failed: batch.length,
        remaining: itemsAwaitingDraft().length,
        stalled: true,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
