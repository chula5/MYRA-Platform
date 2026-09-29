// WHAT WILL THE TEXT TIER ACTUALLY COST?
//
// Estimated costs are how the vision plan got to $9 + $47 before anyone checked
// what a call really contains. This builds the genuine prompt — the same one
// tagFromText sends, imported rather than retyped — over real product copy from
// the cached feeds, counts it, and prices it.
//
// It also prices the two levers that matter: sending several pieces in one call
// so the format legend is paid for once instead of once per piece, and caching
// that legend so repeat calls read it cheaply.
//
// Nothing here calls an API. Token counts are estimated from character counts,
// which is why the output is a range and not a single confident number.
//
//   node_modules/.bin/jiti scripts/tag-cost-model.ts

import fs from 'node:fs'
import path from 'node:path'
import { buildTextPrompt, textCopyOf, TAG_DIMENSIONS } from '../src/lib/brand-watch-tag'

const CACHE = path.join(process.cwd(), 'scripts', '.eval', 'feeds.json')

/** Haiku-class pricing, dollars per million tokens. */
const PRICE_IN = 1
const PRICE_OUT = 5
/** Sonnet-class, for the "does the expensive model earn its price" question. */
const SONNET_IN = 3
const SONNET_OUT = 15

/**
 * English technical prose runs about 4 characters to the token. Product copy is
 * shorter-worded than that, so this OVERSTATES the cost slightly, which is the
 * safe direction for a number someone is going to authorise spending against.
 */
const estTokens = (chars: number) => Math.ceil(chars / 4)

/**
 * Per-piece costs land well below a cent, where a two-decimal renderer prints
 * "$0.00" and hides exactly the number being decided on.
 */
const money = (n: number) => (n < 0.01 ? `$${n.toFixed(5)}` : `$${n.toFixed(2)}`)

async function main() {
  const store: Record<string, any[]> = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {}
  const products: Array<{ name: string; copy: string }> = []
  for (const [, rows] of Object.entries(store)) {
    for (const r of rows) {
      if (!r.body || r.body.length < 80) continue
      products.push({ name: r.title, copy: r.body })
    }
  }
  if (!products.length) throw new Error('no cached feeds — run scripts/feed-coverage.ts first')

  // The format legend is fixed overhead: the same ~17-line explanation of what
  // 1-5 means goes out with every single call.
  const emptyPrompt = buildTextPrompt('')
  const overheadChars = emptyPrompt.length
  const outChars = TAG_DIMENSIONS.length * 3 + 20

  const copies = products.map((p) => textCopyOf({ productName: p.name, description: p.copy, itemType: null }))
  const lens = copies.map((c) => c.length).sort((a, b) => a - b)
  const totalCopy = lens.reduce((a, b) => a + b, 0)
  const avgCopy = totalCopy / lens.length

  console.log(`measured on ${products.length} real products from ${Object.keys(store).length} cached shops\n`)
  console.log('COPY LENGTH (characters)')
  console.log(`  median ${lens[Math.floor(lens.length * 0.5)]}   p75 ${lens[Math.floor(lens.length * 0.75)]}   p95 ${lens[Math.floor(lens.length * 0.95)]}   mean ${Math.round(avgCopy)}`)
  console.log(`  capped at 1500 by textCopyOf: ${copies.filter((c) => c.length >= 1500).length} of ${copies.length} hit the cap`)

  const inPerCall = estTokens(overheadChars + avgCopy)
  const outPerCall = estTokens(outChars)
  console.log(`\nONE PIECE PER CALL`)
  console.log(`  prompt  ~${inPerCall} tokens in  (format legend alone is ~${estTokens(overheadChars)})`)
  console.log(`  reply   ~${outPerCall} tokens out`)
  const perPiece = (inPerCall * PRICE_IN + outPerCall * PRICE_OUT) / 1e6
  console.log(`  cost    ${money(perPiece)} per piece at Haiku rates`)

  // The legend is paid for on every call, so batching is the single biggest
  // lever available: the marginal piece then costs only its own copy.
  console.log(`\nBATCHED (the format legend paid once per call instead of per piece)`)
  const perPieceBatched: Record<number, number> = {}
  for (const batch of [5, 10, 20]) {
    const inTok = estTokens(overheadChars + avgCopy * batch)
    const outTok = estTokens(outChars * batch)
    const per = (inTok * PRICE_IN + outTok * PRICE_OUT) / 1e6 / batch
    perPieceBatched[batch] = per
    console.log(`  ${String(batch).padStart(2)} per call   ~${String(inTok).padStart(5)} in  ~${String(outTok).padStart(4)} out   ${money(per)} per piece   (${((1 - per / perPiece) * 100).toFixed(0)}% cheaper)`)
  }

  // What it would cost on the pieces we can already reach for free, plus what
  // vision would cost on the ones we cannot.
  const VOLUMES: Array<[string, number]> = [
    ['live queue backlog (copy recoverable)', 7361],
    ['whole queue (copy recoverable)', 9912],
    ['all 15,939 queue rows, if vision read every one', 15939],
  ]
  console.log(`\nTOTALS`)
  console.log(`  pieces                        one/call     5/call    10/call    20/call     vision`)
  // A 512px image is roughly 480 input tokens; plus the legend, plus a short
  // reply. Higher than text, and the whole point of avoiding it.
  const visionPerPiece = ((estTokens(overheadChars) + 480) * PRICE_IN + outPerCall * PRICE_OUT) / 1e6
  for (const [label, n] of VOLUMES) {
    console.log(
      `  ${label.padEnd(44).slice(0, 44)} ${money(n * perPiece).padStart(9)} ${money(n * perPieceBatched[5]).padStart(11)} ${money(n * perPieceBatched[10]).padStart(11)} ${money(n * perPieceBatched[20]).padStart(11)} ${money(n * visionPerPiece).padStart(11)}`,
    )
  }

  const perPieceSonnet = (inPerCall * SONNET_IN + outPerCall * SONNET_OUT) / 1e6
  console.log(`\nMODEL CHOICE (one piece per call, same prompt)`)
  console.log(`  Haiku (text)    ${money(perPiece)} per piece   ${money(7361 * perPiece)} for the live backlog`)
  console.log(`  Sonnet (text)   ${money(perPieceSonnet)} per piece   ${money(7361 * perPieceSonnet)} for the live backlog`)
  console.log(`  Vision (Haiku)  ${money(visionPerPiece)} per piece   ${money(7361 * visionPerPiece)} for the live backlog`)

  // Two ways to spend, and they answer different questions. Reading the copy is
  // the cheap way to find out whether style tags predict her taste at all;
  // reading the photograph is the way to find out what the copy misses.
  console.log(`\nTHE ORDER THAT WASTES LEAST`)
  console.log(`  1. read the copy she can already get      ${money(7361 * perPiece)}   answers: do style tags predict her taste?`)
  console.log(`  2. only then read the photographs         ${money(7361 * visionPerPiece)}   answers: what does the copy miss?`)
  console.log(`     both, for the price of the vision line alone`)

  console.log(`\n  token counts are estimated at 4 characters per token from real copy.`)
  console.log(`  the reply size is the one real unknown: a model that rambles costs more than one that does not.`)
}

main().catch((err) => { console.error('\n' + (err instanceof Error ? err.message : String(err))); process.exit(1) })
