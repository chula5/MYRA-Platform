# MYRA — Sprint 1 Setup

## Before you start

### 1. Install Node.js
Download from https://nodejs.org (LTS version). Then verify:
```
node --version
npm --version
```

### 2. Font file
Place `PragmaticaBold.woff2` in:
```
myra/public/fonts/PragmaticaBold.woff2
```
This is already referenced in `globals.css`. The font MUST be here or all text falls back to Arial Black.

### 3. Hero image
Place a hero image at:
```
myra/public/hero-placeholder.jpg
```
Or update the `src` in `src/app/page.tsx` to a Cloudinary URL.

### 4. Environment variables
Copy `.env.local.example` to `.env.local` and fill in your values:
```
cp .env.local.example .env.local
```

Values you need:
- `NEXT_PUBLIC_SUPABASE_URL` — from Supabase project settings
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — from Supabase project settings → API
- `SUPABASE_SERVICE_ROLE_KEY` — from Supabase project settings → API (keep secret)
- `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` — from Cloudinary dashboard
- `ADMIN_USER_ID` — your Supabase auth user ID (find in Supabase → Authentication → Users)

## Running locally

```bash
cd myra
npm install
npm run dev
```

Open http://localhost:3000

## Generating TypeScript types from Supabase

Once the schema is live on Supabase:
```bash
npx supabase login
npx supabase gen types typescript --project-id YOUR_PROJECT_ID > src/types/database.ts
```
This overwrites the placeholder types with exact types from your schema.

## Deploying to Vercel

1. Push the `myra/` directory to GitHub
2. Import project in Vercel
3. Add all env vars from `.env.local` into Vercel project settings
4. Deploy — Vercel auto-detects Next.js

## Database functions needed in Supabase

Two SQL functions are referenced in the codebase. Create them in Supabase SQL editor:

### find_similar_outfits (pgvector cosine similarity)
```sql
CREATE OR REPLACE FUNCTION find_similar_outfits(
  query_vector vector(34),
  occasion_filter text,
  match_count int DEFAULT 12,
  exclude_ids uuid[] DEFAULT '{}'
)
RETURNS SETOF outfit
LANGUAGE sql STABLE
AS $$
  SELECT * FROM outfit
  WHERE status = 'live'
    AND outfit_id != ALL(exclude_ids)
    AND occasion_filter = ANY(occasion_tags)
  ORDER BY taste_vector <=> query_vector
  LIMIT match_count;
$$;
```

### get_outfits_for_item
```sql
CREATE OR REPLACE FUNCTION get_outfits_for_item(
  p_item_id uuid,
  p_exclude_outfit_id uuid,
  p_limit int DEFAULT 3
)
RETURNS SETOF outfit
LANGUAGE sql STABLE
AS $$
  SELECT o.* FROM outfit o
  JOIN outfit_item oi ON o.outfit_id = oi.outfit_id
  WHERE oi.item_id = p_item_id
    AND o.outfit_id != p_exclude_outfit_id
    AND o.status = 'live'
  LIMIT p_limit;
$$;
```

## Sprint 1 checklist

- [ ] Node installed and `npm install` runs without errors
- [ ] `PragmaticaBold.woff2` in `public/fonts/`
- [ ] `.env.local` filled in
- [ ] `npm run dev` opens without errors
- [ ] Landing page renders at localhost:3000
- [ ] Lookbook section pulls from Supabase
- [ ] Pragmatica Bold loads — all text is all caps
- [ ] Feed page shows occasion selector
- [ ] Selecting an occasion loads outfits from Supabase
- [ ] Outfit cards show hotspots and action buttons
- [ ] Tapping SOURCE ITEMS opens left-side panel
- [ ] Outfit detail page opens on card click
- [ ] Admin route at /admin redirects to / if not logged in as admin
- [ ] Deployed to Vercel
