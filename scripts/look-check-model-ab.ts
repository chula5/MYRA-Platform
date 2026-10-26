// CAN SONNET BE THE LOOK CHECK?
//
// checkLook is the last eye before a member sees a look, and it is most of the
// Opus bill: every styling tap, Ask MYRA, Mirror and the MCP run it. Sonnet 5.5
// costs 60% less per token. This puts the same looks through both and shows
// where they disagree, so the switch is a measured call, not a hope.
//
// Two sets of looks:
//   kept     — real stored looks (styled_way). Opus passed all of them, so they
//              show whether Sonnet would wrongly throw good looks away.
//   shuffled — pieces from different stored looks thrown together. Many will
//              clash, so they show the dangerous direction: Sonnet passing a
//              look Opus rejects.
//
// Each look is checked against its member's real description, read fresh.
// Spends real money: about $0.10 per look for both models together.
//
//   JITI_ALIAS="{\"@/\":\"$PWD/src/\",\"server-only\":\"next/dist/compiled/server-only/empty.js\"}" \
//     node_modules/.bin/jiti scripts/look-check-model-ab.ts
//   ... --kept=30 --shuffled=20 --a=claude-opus-5 --b=claude-sonnet-5-5 --concurrency=4

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

const arg = (n: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=')

function readEnv(): Record<string, string> {
  const out: Record<string, string> = {}
  const file = path.join(process.cwd(), '.env.local')
  if (!fs.existsSync(file)) return out
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  return out
}

/** Dollars per million tokens, input and output. */
const PRICES: Record<string, [number, number]> = {
  'claude-opus-5': [5, 25],
  'claude-opus-5-5': [4, 20],
  'claude-sonnet-5-5': [2, 10],
}

type Piece = { image_url?: string | null; item_type?: string | null; product_name?: string | null }
interface Case { id: string; set: 'kept' | 'shuffled'; memberId: string; pieces: Piece[] }
interface Side { verdict: string | null; confidence: number | null; issues: string[]; usd: number; ms: number }

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs]
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}

async function main() {
  Object.assign(process.env, { ...readEnv(), ...process.env })
  const { checkLook, loadClientDescription } = await import('../src/lib/look-check')
  const A = arg('a') ?? 'claude-opus-5'
  const B = arg('b') ?? 'claude-sonnet-5-5'
  const keptN = Number(arg('kept') ?? 30)
  const shuffledN = Number(arg('shuffled') ?? 20)
  const concurrency = Number(arg('concurrency') ?? 4)

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: rows, error } = await db.from('styled_way')
    .select('styled_way_id, member_id, items, verdict')
    .eq('stale', false).not('items', 'is', null)
    .order('created_at', { ascending: false }).limit(400)
  if (error) throw error
  const looks = shuffle((rows ?? []).filter((r: any) => Array.isArray(r.items) && r.items.filter((p: Piece) => p.image_url).length >= 3))

  const cases: Case[] = looks.slice(0, keptN).map((r: any) => ({ id: r.styled_way_id, set: 'kept', memberId: r.member_id, pieces: r.items }))
  // A shuffled look keeps one look's member and slot count, with each slot's
  // piece taken from a different stored look's same slot where there is one.
  const bySlot = new Map<string, Piece[]>()
  for (const r of looks as any[]) for (const p of r.items) {
    const slot = p.slot ?? p.item_type ?? 'other'
    bySlot.set(slot, [...(bySlot.get(slot) ?? []), p])
  }
  for (const r of looks.slice(keptN, keptN + shuffledN) as any[]) {
    const pieces = r.items.map((p: any) => {
      const pool = bySlot.get(p.slot ?? p.item_type ?? 'other') ?? [p]
      return pool[Math.floor(Math.random() * pool.length)]
    })
    cases.push({ id: `${r.styled_way_id}~shuffled`, set: 'shuffled', memberId: r.member_id, pieces })
  }

  const descriptions = new Map<string, string>()
  for (const m of Array.from(new Set(cases.map((c) => c.memberId)))) descriptions.set(m, await loadClientDescription(db, m))

  async function run(model: string, c: Case): Promise<Side> {
    let usd = 0
    const t0 = Date.now()
    const check = await checkLook(c.pieces, descriptions.get(c.memberId)!, {
      model,
      onUsage: (u) => {
        const [pi, po] = PRICES[model] ?? [0, 0]
        usd = ((u.input_tokens ?? 0) * pi + (u.output_tokens ?? 0) * po) / 1_000_000
      },
    })
    return { verdict: check?.verdict ?? null, confidence: check?.confidence ?? null, issues: check?.issues ?? [], usd, ms: Date.now() - t0 }
  }

  console.log(`${cases.length} looks (${keptN} kept, ${cases.length - keptN} shuffled) · ${A} vs ${B}\n`)
  const results: { c: Case; a: Side; b: Side }[] = []
  let next = 0
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < cases.length) {
      const c = cases[next++]
      const [a, b] = await Promise.all([run(A, c), run(B, c)])
      results.push({ c, a, b })
      console.log(`${a.verdict === b.verdict ? '  ' : '≠ '}${c.set.padEnd(8)} ${String(a.verdict).padEnd(10)} ${String(b.verdict).padEnd(10)} ${c.id}`)
    }
  }))

  const ok = results.filter((r) => r.a.verdict && r.b.verdict)
  const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : '—')
  const passes = (v: string | null) => v === 'works' || v === 'borderline'
  console.log(`\n=== ${ok.length} looks both models answered (${results.length - ok.length} failed on one side)`)
  for (const set of ['kept', 'shuffled', 'all'] as const) {
    const s = ok.filter((r) => set === 'all' || r.c.set === set)
    const same = s.filter((r) => r.a.verdict === r.b.verdict).length
    const samePass = s.filter((r) => passes(r.a.verdict) === passes(r.b.verdict)).length
    console.log(`${set.padEnd(9)} same verdict ${pct(same, s.length)} · same show/replace call ${pct(samePass, s.length)}  (n=${s.length})`)
  }
  const verdicts = ['works', 'borderline', 'clashes']
  console.log(`\nrows ${A}, columns ${B}`)
  console.log('             ' + verdicts.map((v) => v.padStart(11)).join(''))
  for (const va of verdicts) {
    console.log(va.padEnd(13) + verdicts.map((vb) => String(ok.filter((r) => r.a.verdict === va && r.b.verdict === vb).length).padStart(11)).join(''))
  }
  const leaks = ok.filter((r) => r.a.verdict === 'clashes' && passes(r.b.verdict))
  const lost = ok.filter((r) => passes(r.a.verdict) && r.b.verdict === 'clashes')
  console.log(`\nDANGEROUS — ${B} would show what ${A} replaces: ${leaks.length}`)
  for (const r of leaks) console.log(`  ${r.c.id}\n    ${A}: ${r.a.issues.join('; ')}\n    ${B}: ${r.b.issues.join('; ') || '(no issues)'}`)
  console.log(`\nWASTEFUL — ${B} would replace what ${A} shows: ${lost.length}`)
  for (const r of lost) console.log(`  ${r.c.id}\n    ${B}: ${r.b.issues.join('; ')}`)

  const sum = (f: (r: typeof ok[number]) => number) => ok.reduce((s, r) => s + f(r), 0)
  const avgMs = (f: (r: typeof ok[number]) => number) => Math.round(sum(f) / Math.max(1, ok.length))
  console.log(`\ncost per look  ${A} $${(sum((r) => r.a.usd) / Math.max(1, ok.length)).toFixed(4)} · ${B} $${(sum((r) => r.b.usd) / Math.max(1, ok.length)).toFixed(4)}`)
  console.log(`time per look  ${A} ${avgMs((r) => r.a.ms)}ms · ${B} ${avgMs((r) => r.b.ms)}ms`)

  const out = path.join(process.cwd(), 'scripts', `look-check-ab-${new Date().toISOString().slice(0, 16).replace(/:/g, '')}.json`)
  fs.writeFileSync(out, JSON.stringify(results.map((r) => ({ id: r.c.id, set: r.c.set, member: r.c.memberId, [A]: r.a, [B]: r.b })), null, 2))
  console.log(`\nevery verdict and issue: ${out}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
