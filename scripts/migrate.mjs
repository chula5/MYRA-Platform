#!/usr/bin/env node
// Apply supabase/migrations/*.sql to the hosted MYRA database.
//
//   npm run migrate                 apply every file not yet recorded, in filename order
//   npm run migrate -- --status     show applied / pending
//   npm run migrate -- --dry-run    show what would run, run nothing
//   npm run migrate -- --only 0090_apple_calendar.sql   run one file (re-runnable; files are idempotent)
//   npm run migrate -- --sql "select 1"                 run one ad-hoc statement and print the rows
//   npm run migrate -- --baseline 0088                  record every file numbered <= 0088 as applied
//                                                       without running it (one-off, for migrations
//                                                       that were pasted into the SQL editor by hand)
//
// Needs in .env.local:
//   NEXT_PUBLIC_SUPABASE_URL   (already there; the project ref is read off it)
//   SUPABASE_ACCESS_TOKEN      a personal access token from
//                              https://supabase.com/dashboard/account/tokens
//
// SQL runs through the Supabase Management API (POST /v1/projects/<ref>/database/query),
// so no database password and no `supabase link` are needed. What has been applied is
// recorded in public.applied_migration, created on first use. The token is never printed.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dir = resolve(root, 'supabase/migrations')

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
if (!ref) fail('NEXT_PUBLIC_SUPABASE_URL is missing from .env.local, so the project ref is unknown.')
if (!token) fail('SUPABASE_ACCESS_TOKEN is missing from .env.local.\nMake one at https://supabase.com/dashboard/account/tokens and add the line\n  SUPABASE_ACCESS_TOKEN=sbp_...\nto .env.local (it is git-ignored).')

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const value = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }

async function query(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  const text = await res.text()
  if (!res.ok) {
    let msg = text
    try { msg = JSON.parse(text).message ?? text } catch {}
    throw new Error(`${res.status} ${msg}`)
  }
  try { return JSON.parse(text) } catch { return text }
}

const TABLE = 'public.applied_migration'
async function ensureTable() {
  await query(`create table if not exists ${TABLE} (
    filename text primary key,
    applied_at timestamptz not null default now(),
    note text
  )`)
}
const q = (s) => `'${String(s).replace(/'/g, "''")}'`
async function applied() {
  const rows = await query(`select filename from ${TABLE} order by filename`)
  return new Set(rows.map((r) => r.filename))
}
async function record(filename, note) {
  await query(`insert into ${TABLE} (filename, note) values (${q(filename)}, ${note ? q(note) : 'null'}) on conflict (filename) do update set applied_at = now(), note = excluded.note`)
}

const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort()
const num = (f) => Number(f.slice(0, 4))

async function run(filename) {
  const sql = readFileSync(resolve(dir, filename), 'utf8')
  process.stdout.write(`  ${filename} … `)
  try {
    await query(sql)
  } catch (e) {
    console.log('FAILED')
    fail(`${filename}: ${e.message}\n\nNothing after it was run. Fix the file (they are meant to be idempotent) and run again.`)
  }
  await record(filename)
  console.log('done')
}

function fail(msg) { console.error(`\n${msg}\n`); process.exit(1) }

async function main() {
  const sql = value('--sql')
  if (sql !== undefined) { console.log(JSON.stringify(await query(sql), null, 2)); return }
  await ensureTable()
  const done = await applied()

  if (flag('--status')) {
    const pending = files.filter((f) => !done.has(f))
    console.log(`${done.size} applied, ${pending.length} pending`)
    for (const f of pending) console.log(`  pending  ${f}`)
    const orphans = [...done].filter((f) => !files.includes(f))
    for (const f of orphans) console.log(`  recorded but not in repo  ${f}`)
    return
  }

  const baseline = value('--baseline')
  if (baseline !== undefined) {
    const upTo = Number(baseline)
    if (!Number.isFinite(upTo)) fail('--baseline wants a number, e.g. --baseline 0088')
    const mark = files.filter((f) => num(f) <= upTo && !done.has(f))
    if (flag('--dry-run')) { for (const f of mark) console.log(`  would record  ${f}`); return }
    for (const f of mark) { await record(f, 'baseline: applied by hand before scripts/migrate.mjs existed'); console.log(`  recorded  ${f}`) }
    console.log(`${mark.length} recorded as already applied.`)
    return
  }

  const only = value('--only')
  if (only !== undefined) {
    const f = files.find((x) => x === only || x.startsWith(only))
    if (!f) fail(`No migration matches ${only}`)
    if (flag('--dry-run')) { console.log(`  would run  ${f}`); return }
    await run(f)
    return
  }

  const pending = files.filter((f) => !done.has(f))
  if (pending.length === 0) { console.log('Nothing pending.'); return }
  if (flag('--dry-run')) { for (const f of pending) console.log(`  would run  ${f}`); return }
  console.log(`Applying ${pending.length} migration${pending.length === 1 ? '' : 's'} to ${ref}:`)
  for (const f of pending) await run(f)
  console.log('All applied.')
}

main().catch((e) => fail(e.message))
