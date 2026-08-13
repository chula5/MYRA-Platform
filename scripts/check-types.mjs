#!/usr/bin/env node
// Fail the build on type errors that are GUARANTEED to break at runtime.
//
// next.config.js sets `typescript: { ignoreBuildErrors: true }`, which is
// deliberate — the Supabase generated types produce a lot of `never` noise that
// would otherwise block every deploy. The cost is that genuinely fatal errors
// ship silently: a missing import for a function that is then called compiles
// fine and throws ReferenceError in the browser, which is exactly how the
// outfit detail page shipped broken.
//
// So rather than turn ignoreBuildErrors off (which needs the Supabase typing
// cleaned up first), this checks the same `tsc` output and fails on ONLY the
// codes that cannot be false positives:
//
//   TS1185  merge conflict marker encountered   — unresolved <<<<<<< / ======= debris
//   TS2304  cannot find name                    — free identifier → ReferenceError
//   TS2552  cannot find name, did you mean …    — same, with a suggestion
//   TS2448  block-scoped variable used before declaration → TDZ ReferenceError
//
// Everything else is reported as a count only, so the existing noise stays
// visible without blocking anyone.

import { spawnSync } from 'node:child_process'

const FATAL = {
  TS1185: 'unresolved merge conflict marker',
  TS2304: 'undefined identifier (ReferenceError at runtime)',
  TS2552: 'undefined identifier (ReferenceError at runtime)',
  TS2448: 'used before declaration (ReferenceError at runtime)',
}

const LINE = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.+)$/

const res = spawnSync('npx', ['tsc', '--noEmit'], {
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
  shell: process.platform === 'win32',
})

const output = `${res.stdout ?? ''}${res.stderr ?? ''}`

// tsc couldn't run at all (missing binary, bad config) — that's a hard failure.
if (res.error || (res.status !== 0 && !LINE.test(output.split('\n').find((l) => LINE.test(l)) ?? ''))) {
  const noErrorLines = !output.split('\n').some((l) => LINE.test(l))
  if (noErrorLines && res.status !== 0) {
    console.error('tsc failed to run:\n' + output.slice(0, 2000))
    process.exit(2)
  }
}

const fatal = []
let otherCount = 0

for (const line of output.split('\n')) {
  const m = LINE.exec(line.trim())
  if (!m) continue
  const [, file, ln, col, code, message] = m
  if (FATAL[code]) fatal.push({ file, ln, col, code, message })
  else otherCount++
}

if (fatal.length === 0) {
  console.log(`✓ No fatal type errors. (${otherCount} non-blocking type errors ignored — see check-types.mjs)`)
  process.exit(0)
}

console.error(`\n✗ ${fatal.length} fatal type error${fatal.length === 1 ? '' : 's'} — these break at runtime:\n`)
for (const f of fatal) {
  console.error(`  ${f.file}:${f.ln}:${f.col}`)
  console.error(`    ${f.code} — ${FATAL[f.code]}`)
  console.error(`    ${f.message}\n`)
}
console.error(`(${otherCount} other type errors ignored as non-blocking.)`)
process.exit(1)
