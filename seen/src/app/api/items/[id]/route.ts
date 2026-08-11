import { NextResponse } from 'next/server';
import { createDraft, getItem, latestDraft, updateItem } from '@/lib/db';
import { DRAFT_TYPE } from '@/lib/anthropic';
import { BUCKETS } from '@/lib/types';
import type { Bucket, Status } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUSES: Status[] = ['new', 'drafted', 'sent', 'dismissed'];

/** Manual bucket override, status change, or an edited draft. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const item = getItem(params.id);
  if (!item) return NextResponse.json({ error: 'No such item.' }, { status: 404 });

  const body = (await req.json()) as {
    bucket?: string;
    status?: string;
    draft_text?: string;
  };

  if (body.bucket !== undefined) {
    if (!BUCKETS.includes(body.bucket as Bucket)) {
      return NextResponse.json({ error: 'Not a bucket.' }, { status: 400 });
    }
    updateItem(item.id, { bucket: body.bucket as Bucket });
  }

  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status as Status)) {
      return NextResponse.json({ error: 'Not a status.' }, { status: 400 });
    }
    updateItem(item.id, { status: body.status as Status });
  }

  if (typeof body.draft_text === 'string') {
    const current = latestDraft(item.id);
    if (body.draft_text.trim() !== current?.draft_text) {
      // A hand-written first draft has no previous version to inherit a type
      // from, so fall back to whatever this bucket produces.
      const bucket = (getItem(item.id)?.bucket ?? 'inspiration') as Bucket;
      createDraft({
        item_id: item.id,
        draft_text: body.draft_text,
        draft_type: current?.draft_type ?? DRAFT_TYPE[bucket],
        edited_by_user: true,
      });
    }
  }

  return NextResponse.json({
    item: getItem(item.id),
    draft: latestDraft(item.id),
  });
}
