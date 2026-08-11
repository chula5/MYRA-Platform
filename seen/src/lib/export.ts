import type { Bucket, Row } from './types';
import { BUCKET_LABEL } from './types';

function when(iso: string | null): string {
  if (!iso) return 'date unknown';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? 'date unknown'
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function toMarkdown(bucket: Bucket, rows: Row[]): string {
  const body = rows
    .filter((r) => r.draft)
    .map(
      (r) =>
        `## ${when(r.item.captured_at ?? r.item.created_at)}\n\n` +
        `> ${(r.item.extracted_text ?? '').split('\n').join('\n> ')}\n\n` +
        `${r.draft!.draft_text}\n`,
    )
    .join('\n---\n\n');

  return `# Seen — ${BUCKET_LABEL[bucket]}\n\n${body || '_Nothing drafted yet._\n'}`;
}

export function toJSON(bucket: Bucket, rows: Row[]): string {
  return JSON.stringify(
    {
      bucket,
      exported_at: new Date().toISOString(),
      items: rows
        .filter((r) => r.draft)
        .map((r) => ({
          id: r.item.id,
          source: r.item.source,
          captured_at: r.item.captured_at,
          extracted_text: r.item.extracted_text,
          draft_text: r.draft!.draft_text,
          draft_type: r.draft!.draft_type,
          version: r.draft!.version,
          edited_by_user: Boolean(r.draft!.edited_by_user),
        })),
    },
    null,
    2,
  );
}

/**
 * Canva Connect cannot create a design from text — POST /v1/designs takes
 * design_type and/or asset_id and has no text body, and Autofill needs a Brand
 * Template (Enterprise). So this formats the draft for pasting into Canva's
 * text fields instead: title line, then body lines, nothing else.
 *
 * TODO: the one real automated path is the Design Import API — render the draft
 * to a .docx/.pptx, upload it to a public URL, POST /v1/imports, poll the job.
 * That's an OAuth flow plus asset hosting plus job polling; more than an hour.
 */
export function toCanva(rows: Row[]): string {
  return rows
    .filter((r) => r.draft)
    .map((r) => {
      const lines = r.draft!.draft_text.split('\n').map((l) => l.trim()).filter(Boolean);
      const title = lines[0]?.replace(/^Hook:\s*/i, '') ?? '';
      const rest = lines.slice(1).map((l) => l.replace(/^[-•]\s*/, ''));
      return [`TITLE: ${title}`, ...rest.map((l) => `BODY: ${l}`)].join('\n');
    })
    .join('\n\n');
}
