#!/usr/bin/env node
// MERGE DUPLICATE MIRROR PIECES — one row per page.
//
// Two asks for the same piece racing on different servers (the panel's quick
// pass and its checked pass, or two taps) each found nothing and each wrote an
// item row for the same retailer_url (Boden "Ara Silk Blend Lace Cami", TOAST
// "Gathered Neck Silk Taffeta Top", PAIGE "Marin Top"… up to four copies, all
// within ~500ms, 2026-10-27 → 11-01). ensureMirrorItem now resolves to the
// OLDEST row per page, but the copies stayed, so Browse answered the same cami
// three times (Fiona, 2026-11-11).
//
// For every retailer_url base (query/hash ignored) with more than one
// non-archived mirror row, this keeps the oldest row and folds the others into
// it: every table that holds an item id is repointed (uuid and text columns,
// uuid[]/text[] arrays, jsonb lists), rows that would collide with one the kept
// piece already has are dropped (a member who saved both copies keeps one
// save), a scored copy lends its reading to an unscored keeper, and the copy
// is archived — not deleted — with a note saying where it went. The merge is
// recorded in public.item_merge.
//
//   node scripts/merge-mirror-duplicates.mjs --dry-run    what would be merged, nothing written
//   node scripts/merge-mirror-duplicates.mjs --rehearse   run the merge and roll it back, printing what it would leave
//   node scripts/merge-mirror-duplicates.mjs              merge, in one transaction
//
// Runs through the Supabase Management API (SUPABASE_ACCESS_TOKEN in .env.local,
// like scripts/migrate.mjs): ~50 referencing columns are rewritten set-wise in
// SQL, which PostgREST cannot do. Run it BEFORE migration 0124, which adds the
// unique index that stops this happening again (the index cannot be built while
// duplicates exist).

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dryRun = process.argv.includes('--dry-run')
const rehearse = process.argv.includes('--rehearse')   // run the whole merge, check it, roll it back

function loadEnv() {
  const file = resolve(root, '.env.local')
  if (!existsSync(file)) return
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!m || process.env[m[1]] !== undefined) continue
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
  }
}
loadEnv()
const token = process.env.SUPABASE_ACCESS_TOKEN
const ref = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').match(/^https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1]
if (!ref || !token) { console.error('Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_ACCESS_TOKEN in .env.local'); process.exit(1) }

async function query(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  const text = await res.text()
  if (!res.ok) { let msg = text; try { msg = JSON.parse(text).message ?? text } catch {}; throw new Error(`${res.status} ${msg}`) }
  try { return JSON.parse(text) } catch { return text }
}

// ── What counts as the same page ────────────────────────────────────────────
// ensureMirrorItem stores the URL without query/hash already; older rows may
// carry one. Same expression as the unique index in migration 0124.
const BASE = "regexp_replace(retailer_url, '[?#].*$', '')"
const DUP_SCOPE = `discovery_source = 'mirror' and status <> 'archived' and retailer_url is not null`

// The mapping: every extra row → the oldest row for its page.
const MAP_SQL = `
  with m as (
    select item_id, created_at, ${BASE} as base_url
    from public.item where ${DUP_SCOPE}
  ), ranked as (
    select item_id, base_url, created_at,
           first_value(item_id) over (partition by base_url order by created_at, item_id) as kept_id
    from m
  )
  select item_id as dup_id, kept_id, base_url from ranked where item_id <> kept_id`

// ── Where item ids live ─────────────────────────────────────────────────────
// Discovered from the schema so a new table is never missed; these are columns
// whose name says item but which do not hold an item id.
const NOT_ITEM_REFS = new Set([
  'item.shopify_inventory_item_id',
  'outfit_item.outfit_item_id',                       // its own key
  'outfit_quality_candidate_item.candidate_item_id',  // its own key
  'outfit_quality_review_event.candidate_item_id',    // → candidate_item
])
// Unique keys that include the item column: the OTHER columns of each, so a
// dup-pointing row that would collide with the kept piece's row is dropped
// before the rest are repointed. An expression (anything with a bracket) is
// used as written, with {a} standing for the row alias.
const UNIQUE_KEYS = {
  'avatar_layer.item_id': ['avatar_id', 'way_key'],
  'event_pick.item_id': ['known_event_id'],
  'item_size_availability.item_id': ['size_label'],
  'member_saved_item.item_id': ['member_id'],
  'mirror_model_shot.item_id': [],
  'our_pick.item_id': ['collection'],
  'outfit_item.item_id': ['outfit_id', 'slot'],
  'outfit_quality_candidate_item.item_id': ['candidate_version_id'],
  'outfit_rescue.sold_item_id': ['outfit_id'],
  'recently_viewed.item_id': ['member_id'],
  'rescue_alternative.item_id': ['rescue_id'],
  'saved_item.item_id': ['user_id'],
  'saved_search_hit.item_id': ['saved_search_id'],
  'second_hand_sale.item_id': [],
  'stock_alert.item_id': ['user_id', 'kind'],
  'stock_subscription.item_id': ['user_id', 'source'],
  'stylist_item_mask.item_id': ['stylist_id'],
  'stylist_trial.item_id': ["coalesce({a}.occasion_id, '')"],
  'styled_way.hero_item_id': ['member_id', 'mode', 'items_signature'],
  'styled_way_demand.hero_item_id': ['member_id', 'mode'],
  // partial: unique while queued/running — handled in its own statement
  'styled_way_job.hero_item_id': ['member_id', 'mode'],
}

const q = (s) => `'${String(s).replace(/'/g, "''")}'`
const keyExpr = (k, a) => (k.includes('(') ? k.replaceAll('{a}', a) : `${a}.${k}`)

async function discoverColumns() {
  const cols = await query(`
    select c.table_name, c.column_name, c.udt_name
    from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.table_name <> 'item'
      and (c.column_name like '%item_id%' or c.column_name like '%item_ids%')
    order by 1, 2`)
  return cols.filter((c) => !NOT_ITEM_REFS.has(`${c.table_name}.${c.column_name}`))
}

// SQL that is true when the column holds a dup id (one row of merge_map per dup).
function refersTo(col, alias, dupExpr) {
  const c = `${alias}.${col.column_name}`
  switch (col.udt_name) {
    case 'uuid': return `${c} = ${dupExpr}`
    case 'text': return `${c} = ${dupExpr}::text`
    case '_uuid': return `${dupExpr} = any(${c})`
    case '_text': return `${dupExpr}::text = any(${c})`
    case 'jsonb': return `${c} @> to_jsonb(${dupExpr}::text)`
    default: throw new Error(`${col.table_name}.${col.column_name}: unexpected type ${col.udt_name}`)
  }
}

async function countRefs(cols) {
  const parts = cols.map((c) => `select ${q(c.table_name)} as t, ${q(c.column_name)} as c, count(*) as n
      from public.${c.table_name} r where exists (select 1 from merge_map m where ${refersTo(c, 'r', 'm.dup_id')})`)
  const rows = await query(`create temp table merge_map as ${MAP_SQL}; ${parts.join(' union all ')} order by 1, 2`)
  return rows.map((r) => ({ ...r, n: Number(r.n) })).filter((r) => r.n > 0)
}

// Drop every row that would collide once its item column points at the kept
// piece: a member who saved two copies keeps one save, and so on. Rows are
// grouped by the piece they will point at plus the unique key's other columns;
// the one already on the kept piece wins, else the first by position. Two
// copies of the same page collide with EACH OTHER as much as with the keeper.
function dropCollisions(t, c, cast, keys, where = 'true') {
  const more = keys.map((k) => `, ${keyExpr(k, 'r')}`).join('')
  return `delete from ${t} x where x.ctid in (
      select ctid from (
        select r.ctid, row_number() over (partition by coalesce(m.kept_id${cast}, r.${c})${more} order by (m.dup_id is null) desc, r.ctid) as rn
        from ${t} r left join merge_map m on m.dup_id${cast} = r.${c}
        where ${where} and coalesce(m.kept_id${cast}, r.${c}) in (select kept_id${cast} from merge_map)
      ) ranked where rn > 1)`
}

// A way to wear names the piece three times: as hero, inside item_ids and
// items (the look), and in items_signature (the sorted ids the unique key
// reads). All three move together, the look first so the signatures of two
// copies' identical looks meet and one is dropped.
const STYLED_WAY_SQL = [
  `with fixed as (
      select r.styled_way_id,
        (select array_agg(coalesce(m.kept_id::text, u.x) order by u.o)
           from unnest(r.item_ids) with ordinality as u(x, o) left join merge_map m on m.dup_id::text = u.x) as ids,
        (select coalesce(jsonb_agg(case when m.kept_id is null then e.v else jsonb_set(e.v, '{item_id}', to_jsonb(m.kept_id::text)) end order by e.o), '[]'::jsonb)
           from jsonb_array_elements(r.items) with ordinality as e(v, o) left join merge_map m on m.dup_id::text = e.v->>'item_id') as items
      from public.styled_way r
      where exists (select 1 from merge_map m where m.dup_id::text = any(r.item_ids) or r.items @> jsonb_build_array(jsonb_build_object('item_id', m.dup_id::text))))
    update public.styled_way r set item_ids = f.ids, items = f.items,
      items_signature = coalesce((select string_agg(x, '|' order by x collate "C") from unnest(f.ids) x), '')
    from fixed f where f.styled_way_id = r.styled_way_id`,
  dropCollisions('public.styled_way', 'hero_item_id', '::text', ['member_id', 'mode', 'items_signature']),
  `update public.styled_way r set hero_item_id = m.kept_id::text from merge_map m where r.hero_item_id = m.dup_id::text`,
]

// The demand ledger adds up: the kept row takes every copy's counts.
const STYLED_WAY_DEMAND_SQL = [
  `insert into public.styled_way_demand (member_id, hero_item_id, mode, source, first_seen_at, last_seen_at, seen, taps, tap_hits)
    select d.member_id, m.kept_id::text, d.mode, (array_agg(d.source order by d.last_seen_at desc))[1],
           min(d.first_seen_at), max(d.last_seen_at), sum(d.seen), sum(d.taps), sum(d.tap_hits)
    from public.styled_way_demand d join merge_map m on d.hero_item_id = m.dup_id::text
    group by d.member_id, m.kept_id, d.mode
    on conflict (member_id, hero_item_id, mode) do update set
      seen = public.styled_way_demand.seen + excluded.seen,
      taps = public.styled_way_demand.taps + excluded.taps,
      tap_hits = public.styled_way_demand.tap_hits + excluded.tap_hits,
      first_seen_at = least(public.styled_way_demand.first_seen_at, excluded.first_seen_at),
      last_seen_at = greatest(public.styled_way_demand.last_seen_at, excluded.last_seen_at)`,
  `delete from public.styled_way_demand d using merge_map m where d.hero_item_id = m.dup_id::text`,
]

// The repoint for one column — a list of statements, run inside the transaction.
function repointSql(col) {
  const t = `public.${col.table_name}`
  const key = `${col.table_name}.${col.column_name}`
  const c = col.column_name
  if (col.table_name === 'styled_way') return []              // STYLED_WAY_SQL, once
  if (key === 'styled_way_demand.hero_item_id') return STYLED_WAY_DEMAND_SQL
  const out = []
  if (col.udt_name === 'uuid' || col.udt_name === 'text') {
    const cast = col.udt_name === 'text' ? '::text' : ''
    const keys = UNIQUE_KEYS[key]
    if (key === 'styled_way_job.hero_item_id') {
      // unique only while queued/running: one live job per piece and mode
      out.push(dropCollisions(t, c, cast, keys, "r.status in ('queued','running')"))
    } else if (keys) {
      out.push(dropCollisions(t, c, cast, keys))
    }
    out.push(`update ${t} r set ${c} = m.kept_id${cast} from merge_map m where r.${c} = m.dup_id${cast}`)
  } else if (col.udt_name === '_uuid' || col.udt_name === '_text') {
    const cast = col.udt_name === '_text' ? '::text' : ''
    out.push(`update ${t} r set ${c} = (
        select array_agg(coalesce(m.kept_id${cast}, u.x) order by u.o)
        from unnest(r.${c}) with ordinality as u(x, o) left join merge_map m on m.dup_id${cast} = u.x)
      where exists (select 1 from merge_map m where m.dup_id${cast} = any(r.${c}))`)
  } else if (col.udt_name === 'jsonb') {
    out.push(`update ${t} r set ${c} = (
        select coalesce(jsonb_agg(coalesce(to_jsonb(m.kept_id::text), e.v) order by e.o), '[]'::jsonb)
        from jsonb_array_elements(r.${c}) with ordinality as e(v, o) left join merge_map m on to_jsonb(m.dup_id::text) = e.v)
      where jsonb_typeof(r.${c}) = 'array' and exists (select 1 from merge_map m where r.${c} @> to_jsonb(m.dup_id::text))`)
  }
  return out
}

// A scored copy lends its reading to an unscored keeper — otherwise the next
// ask pays a vision call to read a picture MYRA has already read.
const SCORE_COLS = ['fit', 'length', 'rise', 'structure', 'shoulder', 'waist_definition', 'leg_opening', 'surface',
  'colour_depth', 'pattern', 'sheen', 'material_weight', 'material_formality', 'neckline', 'sleeve',
  'colour_family', 'material_category', 'material_primary', 'colour_hex']

async function main() {
  const dups = await query(MAP_SQL)
  const before = await query(`select count(*) as rows, count(distinct ${BASE}) as pages from public.item where ${DUP_SCOPE}`)
  const pages = new Map()
  for (const d of dups) { if (!pages.has(d.kept_id)) pages.set(d.kept_id, { base: d.base_url, dups: [] }); pages.get(d.kept_id).dups.push(d.dup_id) }
  console.log(`${dryRun ? 'DRY RUN — ' : ''}non-archived mirror rows: ${before[0].rows} on ${before[0].pages} pages · ${pages.size} pages with ${dups.length} extra row(s)`)
  if (!dups.length) { console.log('Nothing to merge.'); return }

  const names = await query(`select i.item_id, i.product_name, b.name as brand, i.created_at, i.scored_at is not null as scored
    from public.item i left join public.brand b on b.brand_id = i.brand_id
    where i.item_id in (${[...pages.keys(), ...dups.map((d) => d.dup_id)].map(q).join(',')})`)
  const byId = new Map(names.map((n) => [n.item_id, n]))
  for (const [kept, p] of pages) {
    const k = byId.get(kept)
    console.log(`\n${k?.brand ?? '—'} · ${k?.product_name ?? kept}\n  ${p.base}\n  keep ${kept} (${k?.created_at?.slice(0, 19)}${k?.scored ? ', scored' : ''})`)
    for (const d of p.dups) { const r = byId.get(d); console.log(`  fold ${d} (${r?.created_at?.slice(0, 19)}${r?.scored ? ', scored' : ''})`) }
  }

  const cols = await discoverColumns()
  const refs = await countRefs(cols)
  console.log(`\nReferences to the extra rows (${cols.length} columns checked):`)
  if (!refs.length) console.log('  none')
  for (const r of refs) console.log(`  ${r.t}.${r.c}: ${r.n}${UNIQUE_KEYS[`${r.t}.${r.c}`] ? '  (unique key — collisions dropped)' : ''}`)
  const unknownUnique = await query(`select tablename, indexdef from pg_indexes where schemaname = 'public' and indexdef like 'CREATE UNIQUE%'
    and (${cols.map((c) => `(tablename = ${q(c.table_name)} and indexdef like ${q(`%${c.column_name}%`)})`).join(' or ')})`)
  for (const u of unknownUnique) {
    const col = cols.find((c) => c.table_name === u.tablename && u.indexdef.includes(c.column_name))
    if (col && !UNIQUE_KEYS[`${col.table_name}.${col.column_name}`]) console.log(`  ! unique index on ${col.table_name}.${col.column_name} not in UNIQUE_KEYS: ${u.indexdef}`)
  }
  if (dryRun) { console.log(`\nWould archive ${dups.length} row(s), leaving ${before[0].rows - dups.length} on ${before[0].pages} pages. Nothing written.`); return }

  const stamp = new Date().toISOString().slice(0, 10)
  // Tables where a repoint can collide: how many rows each has now, so the
  // report can say how many were folded (a member's two saves become one).
  const keyed = [...new Set(refs.filter((r) => UNIQUE_KEYS[`${r.t}.${r.c}`]).map((r) => r.t))]
  const sizeSql = keyed.map((t) => `(select count(*) from public.${t}) as "${t}"`).join(', ')
  const sizesBefore = keyed.length ? (await query(`select ${sizeSql}`))[0] : {}
  const statements = [
    'begin',
    "set local statement_timeout = '300s'",
    `create temp table merge_map as ${MAP_SQL}`,
    `create table if not exists public.item_merge (
      dup_item_id uuid primary key, kept_item_id uuid not null, base_url text not null,
      merged_at timestamptz not null default now(), note text)`,
    `insert into public.item_merge (dup_item_id, kept_item_id, base_url, note)
      select dup_id, kept_id, base_url, 'merge-mirror-duplicates ${stamp}' from merge_map on conflict (dup_item_id) do nothing`,
  ]
  if (refs.some((r) => r.t === 'styled_way')) statements.push(...STYLED_WAY_SQL)
  for (const c of cols) if (refs.some((r) => r.t === c.table_name && r.c === c.column_name)) statements.push(...repointSql(c))
  statements.push(`update public.item k set ${SCORE_COLS.map((c) => `${c} = coalesce(k.${c}, d.${c})`).join(', ')}, scored_at = d.scored_at
    from (select distinct on (m.kept_id) m.kept_id, i.* from merge_map m join public.item i on i.item_id = m.dup_id where i.scored_at is not null order by m.kept_id, i.scored_at desc) d
    where k.item_id = d.kept_id and k.scored_at is null`)
  statements.push(`update public.item i set status = 'archived',
      admin_notes = concat_ws(E'\\n', i.admin_notes, 'Merged into ' || m.kept_id || ' on ${stamp} (same page written twice)')
    from merge_map m where i.item_id = m.dup_id`)
  const leftover = cols.map((c) => `select count(*) as n from public.${c.table_name} r where exists (select 1 from merge_map m where ${refersTo(c, 'r', 'm.dup_id')})`).join(' union all ')
  statements.push(`select (select count(*) from public.item where ${DUP_SCOPE}) as rows,
    (select count(*) from (select 1 from public.item where ${DUP_SCOPE} group by ${BASE} having count(*) > 1) x) as pages_still_doubled,
    (select sum(n) from (${leftover}) x) as refs_left,
    (select count(*) from public.item where status = 'archived' and admin_notes like '%Merged into%on ${stamp}%') as archived_now${sizeSql ? ', ' + sizeSql : ''}`)
  statements.push(rehearse ? 'rollback' : 'commit')
  const check = await query(statements.map((s) => s.trim().replace(/;?$/, ';')).join('\n'))
  const r = Array.isArray(check) ? check[0] : null
  const folded = keyed.map((t) => [t, Number(sizesBefore[t]) - Number(r?.[t])]).filter(([, n]) => n > 0)
  const foldedLine = folded.length ? `rows folded into one the kept piece already had: ${folded.map(([t, n]) => `${t} ${n}`).join(', ')}` : 'no rows folded'
  if (rehearse) { console.log(`\nREHEARSAL (rolled back) — would leave: non-archived mirror rows ${r?.rows} · pages still doubled ${r?.pages_still_doubled} · references left on copies ${r?.refs_left} · archived ${r?.archived_now}\n${foldedLine}`); return }

  const after = await query(`select count(*) as rows, count(distinct ${BASE}) as pages,
    (select count(*) from (select 1 from public.item where ${DUP_SCOPE} group by ${BASE} having count(*) > 1) x) as pages_still_doubled
    from public.item where ${DUP_SCOPE}`)
  const left = await countRefs(cols)
  console.log(`\nMerged. non-archived mirror rows: ${after[0].rows} on ${after[0].pages} pages · pages still doubled: ${after[0].pages_still_doubled}`)
  console.log(foldedLine)
  console.log(left.length ? `References still pointing at archived copies: ${left.map((r) => `${r.t}.${r.c}=${r.n}`).join(', ')}` : 'No references left on the archived copies.')
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1) })
