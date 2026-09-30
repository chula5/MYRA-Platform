// Pack MYRA Mirror for the Chrome Web Store.
//
//   node scripts/pack-extension.mjs
//
// Writes extension-dist/myra-mirror-<version>.zip from ./extension with a
// STORE manifest: the localhost entries that let Chloe develop against her
// dev server are removed (a reviewer should not see them, and a client never
// needs them). Nothing else changes — what is zipped is what runs. The
// checks below are the store's own rules, applied before upload rather than
// after a rejection.

import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync, readdirSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join } from 'node:path'

const SRC = 'extension'
const OUT = 'extension-dist'
const manifest = JSON.parse(readFileSync(join(SRC, 'manifest.json'), 'utf8'))

const problems = []
if (manifest.description.length > 132) problems.push(`description is ${manifest.description.length} chars (store limit 132)`)
if ((manifest.permissions ?? []).includes('scripting')) problems.push("'scripting' permission is declared but never used — the store rejects unused permissions")
for (const size of ['16', '32', '48', '128']) {
  if (!existsSync(join(SRC, manifest.icons?.[size] ?? ''))) problems.push(`icon ${size} missing`)
}
if (problems.length) {
  console.error('Not packed:\n  - ' + problems.join('\n  - '))
  process.exit(1)
}

const isLocal = (s) => /^https?:\/\/localhost/.test(s)
const storeManifest = {
  ...manifest,
  content_scripts: (manifest.content_scripts ?? [])
    .map((cs) => ({
      ...cs,
      matches: cs.matches.filter((m) => !isLocal(m)),
      ...(cs.exclude_matches ? { exclude_matches: cs.exclude_matches.filter((m) => !isLocal(m)) } : {}),
    }))
    .filter((cs) => cs.matches.length),
}

// Clear only what this script made: its stage and old zips. store/ holds the
// listing images and is not ours to wipe.
const stage = join(OUT, 'stage')
rmSync(stage, { recursive: true, force: true })
if (existsSync(OUT)) for (const f of readdirSync(OUT)) if (f.endsWith('.zip')) rmSync(join(OUT, f))
mkdirSync(stage, { recursive: true })
cpSync(SRC, stage, { recursive: true })
writeFileSync(join(stage, 'manifest.json'), JSON.stringify(storeManifest, null, 2) + '\n')

const zip = `myra-mirror-${manifest.version}.zip`
// Docs stay out of the package: STORE.md is for Chloe, not the store.
execSync(`cd "${stage}" && zip -qr "../${zip}" . -x ".*" -x "__MACOSX/*" -x "*.md"`)
rmSync(stage, { recursive: true, force: true })
console.log(`packed ${join(OUT, zip)}  (v${manifest.version}, ${manifest.description.length}-char description, localhost entries removed)`)
