import Anthropic from '@anthropic-ai/sdk';
import type { Bucket, Item, Settings } from './types';

/**
 * Sonnet 4.6 does not support structured outputs (`output_config.format`), so
 * every shaped response here is forced through tool use with `tool_choice`.
 * Same guarantee, works on this model.
 */
export const MODEL = 'claude-sonnet-4-6';

let _client: Anthropic | null = null;

export function client(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Copy .env.local.example to .env.local and fill it in.',
    );
  }
  if (!_client) _client = new Anthropic();
  return _client;
}

export const SUPPORTED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
] as const;

export type SupportedImageType = (typeof SUPPORTED_IMAGE_TYPES)[number];

export function isSupportedImage(mime: string): mime is SupportedImageType {
  return (SUPPORTED_IMAGE_TYPES as readonly string[]).includes(mime);
}

/** Bounded-concurrency map. Keeps 50 screenshots from opening 50 sockets. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

function voiceBlock(s: Settings): string {
  const bits = [
    s.my_business_description && `Business: ${s.my_business_description}`,
    s.my_tone_of_voice && `How they write: ${s.my_tone_of_voice}`,
    s.my_offer && `What they sell: ${s.my_offer}`,
  ].filter(Boolean);

  if (!bits.length) {
    return `The user has not filled in their voice settings yet. Write plainly and
specifically. Do not invent details about their business.`;
  }
  return `Everything you write is for this person. Sound like them, not like an AI.

${bits.join('\n')}`;
}

/* ------------------------------------------------- stage 1: extract + sort */

const FILE_IT_TOOL: Anthropic.Tool = {
  name: 'file_it',
  description: 'Record what is in this image and which bucket it belongs in.',
  input_schema: {
    type: 'object',
    properties: {
      bucket: {
        type: 'string',
        enum: ['people', 'inspiration', 'notes'],
        description:
          'people = a screenshot of a person\'s professional profile (LinkedIn or similar). ' +
          'inspiration = a saved social post, article, ad, or other content made by someone else. ' +
          'notes = the user\'s own writing — typed notes, handwriting, a whiteboard, a memo.',
      },
      extracted_text: {
        type: 'string',
        description:
          'Everything legible in the image, transcribed faithfully. For a profile: name, ' +
          'headline, company, role, and any specific detail worth referencing. For a post: ' +
          'the caption and any on-image text. For a note: the note verbatim. If the image ' +
          'carries meaning beyond its text, add one short line describing it.',
      },
    },
    required: ['bucket', 'extracted_text'],
  },
};

const EXTRACT_SYSTEM = `You sort screenshots for someone who saves far more than they act on.

For each image: transcribe what is actually there, and file it into exactly one bucket.
Transcribe only what you can see. Never invent a name, company, or figure. If the image is
unreadable, say so in extracted_text and pick the closest bucket.`;

export async function extractAndClassify(input: {
  base64: string;
  mediaType: SupportedImageType;
}): Promise<{ bucket: Bucket; extracted_text: string }> {
  const res = await client().messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: EXTRACT_SYSTEM,
    thinking: { type: 'disabled' },
    output_config: { effort: 'low' },
    tools: [FILE_IT_TOOL],
    tool_choice: { type: 'tool', name: 'file_it' },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: input.mediaType, data: input.base64 },
          },
          { type: 'text', text: 'Transcribe this and file it.' },
        ],
      },
    ],
  });

  const call = res.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'file_it',
  );
  if (!call) throw new Error('Model returned no classification for this image.');

  const parsed = call.input as { bucket: Bucket; extracted_text: string };
  return {
    bucket: parsed.bucket,
    extracted_text: (parsed.extracted_text ?? '').trim(),
  };
}

/* ------------------------------------------------------- stage 2: drafting */

export const DRAFT_TYPE: Record<Bucket, string> = {
  people: 'outreach',
  inspiration: 'content_idea',
  notes: 'content_idea',
};

const BUCKET_BRIEF: Record<Bucket, string> = {
  people: `Each source is a screenshot of someone's professional profile. Write a short
outreach message to that person. Exactly three beats, in order:

1. One specific hook pulled from their profile — a named detail only someone who
   actually read it would know. Not "your impressive background".
2. One line on why this person is reaching out to them.
3. One soft ask. An invitation, not a pitch.

Hard rules: under 300 characters total. No "I hope this finds you well". No
"I came across your profile". No flattery adjectives. No exclamation marks.
Plain sentences. If the profile is too thin for a specific hook, say so in the
draft rather than inventing one.`,

  inspiration: `Each source is a post or piece of content someone else made, which the
user saved. Use it as a reference point — the angle it takes, the format it uses,
the idea underneath it — and turn it into a content idea for the user's own business.

Format each draft exactly like this, with these labels:

Hook: [one line, the thing that stops the scroll]
Angle: [one or two sentences on the argument being made and why it lands]
Format: [carousel, reel, or post — pick one, one clause on why]
- [substantive point]
- [substantive point]
- [substantive point]

The three bullets must carry actual content — a claim, a number, a specific
example. Not "explain the benefits". Never tell the user to copy the source.`,

  notes: `Each source is the user's own note — typed or handwritten. Treat it as the
seed thought, not a reference to react to. The idea is already theirs; develop it.

Format each draft exactly like this, with these labels:

Hook: [one line, the thing that stops the scroll]
Angle: [one or two sentences on the argument being made and why it lands]
Format: [carousel, reel, or post — pick one, one clause on why]
- [substantive point]
- [substantive point]
- [substantive point]

The three bullets must carry actual content — a claim, a number, a specific
example. Not "explain the benefits". Stay faithful to what the note actually says.`,
};

const WRITE_DRAFTS_TOOL: Anthropic.Tool = {
  name: 'write_drafts',
  description: 'Return one finished draft for every source, in the same order.',
  input_schema: {
    type: 'object',
    properties: {
      drafts: {
        type: 'array',
        description: 'One entry per source. Do not skip any source.',
        items: {
          type: 'object',
          properties: {
            index: {
              type: 'integer',
              description: 'The number labelling the source this draft is for.',
            },
            draft_text: {
              type: 'string',
              description: 'The finished draft, ready to send or post as written.',
            },
          },
          required: ['index', 'draft_text'],
        },
      },
    },
    required: ['drafts'],
  },
};

/** How many items go into a single drafting call. */
export const DRAFT_BATCH_SIZE = 5;

function ago(iso: string | null): string {
  if (!iso) return 'unknown';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (!Number.isFinite(days) || days < 0) return 'unknown';
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 24) return `${months} month${months === 1 ? '' : 's'} ago`;
  return `${Math.floor(months / 12)} years ago`;
}

/**
 * One call per chunk of items — genuine batching, not N sequential calls.
 * Chunks are per-bucket because each bucket has its own brief.
 */
export async function draftBatch(
  bucket: Bucket,
  items: Item[],
  settings: Settings,
): Promise<Map<string, string>> {
  const system = `You write drafts for someone who saved these things and then did nothing
with them. Your job is to make each one immediately usable — something they could send or
post as written, without editing.

${voiceBlock(settings)}

${BUCKET_BRIEF[bucket]}

Write in plain language. No preamble, no meta-commentary, no "here's a draft". Return one
draft per source via the write_drafts tool.`;

  const sources = items
    .map(
      (item, i) =>
        `--- SOURCE ${i + 1} (saved ${ago(item.captured_at ?? item.created_at)}) ---\n` +
        `${item.extracted_text?.trim() || '(nothing legible was extracted from this image)'}`,
    )
    .join('\n\n');

  const res = await client().messages.create({
    model: MODEL,
    max_tokens: 8000,
    system,
    thinking: { type: 'disabled' },
    output_config: { effort: 'medium' },
    tools: [WRITE_DRAFTS_TOOL],
    tool_choice: { type: 'tool', name: 'write_drafts' },
    messages: [
      {
        role: 'user',
        content: `${sources}\n\nWrite one draft for each of the ${items.length} sources above.`,
      },
    ],
  });

  const call = res.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'write_drafts',
  );
  if (!call) throw new Error('Model returned no drafts for this batch.');

  const parsed = call.input as { drafts?: { index: number; draft_text: string }[] };
  const out = new Map<string, string>();
  for (const d of parsed.drafts ?? []) {
    const item = items[d.index - 1];
    if (item && d.draft_text?.trim()) out.set(item.id, d.draft_text.trim());
  }
  return out;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
