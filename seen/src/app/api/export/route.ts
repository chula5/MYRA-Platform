import { NextResponse } from 'next/server';
import { recordExport, rows } from '@/lib/db';
import { toCanva, toJSON, toMarkdown } from '@/lib/export';
import { BUCKETS } from '@/lib/types';
import type { Bucket, Destination } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DESTINATIONS: Destination[] = ['clipboard', 'markdown', 'json', 'canva'];

export async function POST(req: Request) {
  const { bucket, destination } = (await req.json()) as {
    bucket?: string;
    destination?: string;
  };

  if (!BUCKETS.includes(bucket as Bucket)) {
    return NextResponse.json({ error: 'Not a bucket.' }, { status: 400 });
  }
  if (!DESTINATIONS.includes(destination as Destination)) {
    return NextResponse.json({ error: 'Not a destination.' }, { status: 400 });
  }

  const b = bucket as Bucket;
  const d = destination as Destination;
  const list = rows(b).filter((r) => r.draft);

  if (!list.length) {
    return NextResponse.json({ error: 'Nothing drafted in here yet.' }, { status: 400 });
  }

  const content =
    d === 'json'
      ? toJSON(b, list)
      : d === 'canva'
        ? toCanva(list)
        : toMarkdown(b, list);

  for (const r of list) recordExport(r.draft!.id, d);

  return NextResponse.json({
    content,
    count: list.length,
    filename: d === 'json' ? `seen-${b}.json` : `seen-${b}.md`,
    // Canva Connect has no text -> design endpoint. See src/lib/export.ts.
    note: d === 'canva' ? 'Formatted for pasting into Canva text fields.' : undefined,
  });
}
