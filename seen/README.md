# Seen

**Saved isn't done.**

You screenshot LinkedIn profiles, save Instagram posts, and scribble notes — and then
never do anything with any of it. Seen turns that pile into drafts you can send or post.

The promise is accountability, not storage.

---

## Run it

```bash
cd seen
npm install
cp .env.local.example .env.local   # add your ANTHROPIC_API_KEY
npm run dev                        # http://localhost:3100
```

Requires **Node 22.5+** — the database is `node:sqlite`, which is built into Node. There
is no external infrastructure, no migration step, and no ORM. The whole database is one
file at `data/seen.db`, created on first run.

`ANTHROPIC_API_KEY` is the only variable you actually need. Everything else in
`.env.local.example` is optional.

---

## The flow

1. **`/`** — landing.
2. **`/connect`** — two toggles: Photo album and Instagram.
3. **`/import`** — pick screenshots, watch them get read and sorted.
4. **`/table`** — three tabs, one per bucket, each row a source plus its draft.
5. **`/voice`** — the one-time form that makes drafts sound like you.

## The three buckets

| Bucket | Source | Draft |
|---|---|---|
| **People** | LinkedIn-style profile screenshots | Outreach message: one specific hook from their profile, one line on why you're reaching out, one soft ask. Under 300 characters. |
| **Inspiration** | Saved posts, content screenshots | Content idea: hook, angle, format (carousel / reel / post), three bullets of substance. |
| **Notes** | Typed or handwritten notes | Same structure, but the note is the seed thought rather than a reference. |

Classification is automatic from the image. Every row has a bucket dropdown to override it.

---

## Two things that are not technically possible

Both were checked against current documentation before building. Neither is faked.

### Instagram saved posts are not available to third parties

The Instagram Basic Display API reached **end-of-life in December 2024**. The Instagram
Graph API that replaced it exposes, for your own Business or Creator account:
`/media`, `/stories`, `/tags`, `/mentioned_media`. There is **no saved-media,
bookmarks, or collections edge** — collections are a private, user-facing Instagram
feature and are not offered to any third party.

So Seen ships the OAuth flow (`/api/instagram/auth` → `/api/instagram/callback`) and
`/api/instagram/import` pulls what the API genuinely permits: your own posts. The
connect screen says this plainly rather than implying otherwise.

**The real Instagram path is the share sheet / manual upload.** Screenshot the save or
share it into the album, then import it like anything else. This is the primary route,
not a degraded fallback.

### Canva cannot create a design from text

`POST /v1/designs` on the Canva Connect API requires `design_type` and/or `asset_id` —
there is no text body. The Autofill API can populate text, but only into a Brand
Template, which is a Canva Enterprise feature.

So the Canva button does **"Copy formatted for Canva"**: it flattens each draft into
`TITLE:` / `BODY:` lines ready to paste into Canva's text fields.

> **TODO** — the one genuinely automated route is the **Design Import API**: render each
> draft to a `.docx`/`.pptx`, host it at a public URL, `POST /v1/imports`, then poll the
> job to completion. That is an OAuth flow plus asset hosting plus job polling — well
> over an hour of work, so it is deliberately not in v1. See `src/lib/export.ts`.

---

## How the model is used

`claude-sonnet-4-6`, in two stages.

**Stage 1 — extract and classify.** Each image goes to the model directly for vision
extraction; there is no OCR dependency. One call per image, run at a concurrency of 4.
Returns a transcription and a bucket.

**Stage 2 — draft.** Genuinely batched: up to **5 items go into a single call**, and the
model returns an array of drafts. Batches are per-bucket because each bucket has its own
brief. The three `/voice` answers are injected into every drafting prompt.

Sonnet 4.6 does not support structured outputs (`output_config.format`), so both stages
force their response shape through **tool use with `tool_choice`** instead. Same
guarantee, works on this model.

Both stages are driven in slices — `/api/process` and `/api/draft` each handle one slice
per request and report what's left, so the import screen shows honest progress instead of
a spinner. If a pass makes no progress, the client stops rather than looping.

The **Message Batches API** is deliberately not used. It is 50% cheaper but can take up
to an hour, which is the wrong trade for an interactive import.

---

## Data model

`data/seen.db`, four tables.

- **items** — `id`, `created_at`, `source` (`photos` | `instagram` | `manual`),
  `bucket` (`people` | `inspiration` | `notes`), `image_url`, `extracted_text`,
  `captured_at`, `status` (`new` | `drafted` | `sent` | `dismissed`)
- **drafts** — `id`, `item_id`, `draft_text`, `draft_type`, `generated_at`,
  `edited_by_user`, `version`
- **exports** — `id`, `draft_id`, `destination` (`clipboard` | `markdown` | `json` |
  `canva`), `exported_at`
- **settings** — the three voice fields, plus connection state for the two sources

Editing a draft never overwrites the model's version — it writes a new row with
`version + 1` and `edited_by_user = 1`.

`captured_at` comes from the file's own timestamp, which is what makes *"You
screenshotted this 4 months ago"* true rather than decorative.

---

## Known limits

- **HEIC is not supported.** iPhone screenshots are usually PNG and fine, but photos of
  handwritten notes are often HEIC. Those are skipped with a visible reason. Export as
  JPEG. Adding conversion means a native image dependency, which the brief ruled out.
- **Images are sent at full resolution.** Sonnet 4.6 caps at 1568px on the long edge and
  downscales server-side. Fifty large screenshots is a real cost; check your usage before
  importing a year of camera roll.
- **Single user.** No auth, one settings row, local database. As specified.
- **Refiling a row does not automatically redraft it.** The old draft stays until you
  clear it. Use "Draft the last N" for anything undrafted.
