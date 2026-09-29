// IS THE SHOP'S COPY ACTUALLY ABOUT THE GARMENT?
//
// Fetching product copy for free only helps if the copy says something. Two
// things could make it worthless: it might be brand boilerplate repeated across
// every product (Brora opens every one of its product pages with the same
// capsule blurb), or it might be marketing with no shape words in it at all.
//
// So this measures, per brand: how much of the copy is unique to the product,
// and how often the copy names the things the tagger needs to read — a
// silhouette, a neckline, a rise, a hem, a sleeve.
//
// Only the style words matter here, so the check is deliberately generous: one
// mention of "silhouette" is enough to tell us there is a garment description
// on the page, not a shipping policy.
//
//   node_modules/.bin/jiti scripts/copy-quality.ts

import fs from 'node:fs'
import path from 'node:path'

const CACHE = path.join(process.cwd(), 'scripts', '.eval', 'feeds.json')

/** Words that appear only when a page is describing a garment's shape. */
const SHAPE = /\b(?:silhouette|neckline|shoulder|sleeve|hem(?:line)?|waist|rise|inseam|leg|lapel|fit|fitted|tailored|oversized|relaxed|slim|straight|flared|barrel|wide|narrow|column|aline|a-line|draped?|gathered|pleated|ruched|cropped|longline|midi|maxi|mini|petite|lined?|cut)\b/gi
const FABRIC = /\b(?:cotton|wool|silk|linen|cashmere|denim|leather|suede|satin|velvet|corduroy|jersey|twill|poplin|crepe|viscose|linen|mohair|alpaca|yak|boucl|sequin|crochet|knit|gauge|mesh|nylon|polyester|lurex|jacquard|organza|chiffon|tulle)\b/gi

const count = (t: string, re: RegExp) => (t.match(re) ?? []).length

async function main() {
  const store: Record<string, any[]> = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {}
  const usable = Object.entries(store).filter(([, rows]) => rows.length >= 30 && rows.some((r) => r.body.length > 80))
  if (!usable.length) throw new Error('no cached feeds — run scripts/free-tags-report.ts or scripts/feed-coverage.ts first')

  console.log('IS THE COPY ABOUT THE GARMENT?\n')
  console.log('  brand                        items  shape  fabric  ≥1 shape   ≥3 shape   unique copy')
  let allN = 0, allShape = 0, allThree = 0
  let uniqW = 0, uniqN = 0

  for (const [url, rows] of usable) {
    const withCopy = rows.filter((r) => r.body.length > 80)
    if (withCopy.length < 30) continue

    // How much of a description is copy-pasted from another product in the same
    // shop? Compared on sentences: a shared opening paragraph is boilerplate, a
    // shared sentence fragment usually is not.
    const seen = new Map<string, number>()
    for (const r of withCopy) for (const s of r.body.split(/(?<=[.!?])\s+/)) {
      const k = s.trim().slice(0, 90)
      if (k.length > 40) seen.set(k, (seen.get(k) ?? 0) + 1)
    }

    let shapeAny = 0, shapeThree = 0, shapeTotal = 0, fabricTotal = 0
    for (const r of withCopy) {
      const s = count(r.body, SHAPE)
      shapeTotal += s
      fabricTotal += count(r.body, FABRIC)
      if (s >= 1) shapeAny++
      if (s >= 3) shapeThree++
      const sents = r.body.split(/(?<=[.!?])\s+/).filter((x: string) => x.trim().length > 40)
      const own = sents.filter((x: string) => (seen.get(x.trim().slice(0, 90)) ?? 0) === 1).length
      uniqW += own
      uniqN += sents.length
    }
    allN += withCopy.length
    allShape += shapeAny
    allThree += shapeThree

    const pct = (n: number, d: number) => `${((100 * n) / d).toFixed(0)}%`
    const name = url.replace(/^https?:\/\/(?:www\.)?/, '').split('.')[0]
    console.log(
      `  ${name.slice(0, 26).padEnd(26)} ${String(withCopy.length).padStart(5)} ${(shapeTotal / withCopy.length).toFixed(1).padStart(6)} ${(fabricTotal / withCopy.length).toFixed(1).padStart(7)}   ` +
      `${pct(shapeAny, withCopy.length).padStart(7)}   ${pct(shapeThree, withCopy.length).padStart(8)}   ${pct(uniqW, uniqN).padStart(10)}`,
    )
  }

  console.log(`\n  across ${allN} products: ${((100 * allShape) / allN).toFixed(0)}% of descriptions name at least one garment-shape word, ${((100 * allThree) / allN).toFixed(0)}% name three or more.`)
  console.log(`  ${((100 * uniqW) / uniqN).toFixed(0)}% of sentences are unique to their own product.`)
}

main().catch((err) => { console.error('\n' + (err instanceof Error ? err.message : String(err))); process.exit(1) })
