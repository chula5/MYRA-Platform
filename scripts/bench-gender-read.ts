// WHICH READER SHOULD DECIDE MEN'S FROM WOMEN'S?
//
// The gender read is the last one still on Anthropic, and that key is out of
// credit. It is also the read that decides what MYRA shows, which is why it was
// the one moved UP to a stronger model: Haiku once read a plainly male model in
// cropped shorts as womenswear and a whole queue of menswear followed. So the
// cheap reader has to earn this, not inherit it.
//
// The population matters more than the sample size. The scan reads the feed's
// own product type, tags, title and handle for free, and a piece whose feed
// states a gender NEVER reaches this read — so a bench of labelled pieces
// measures a population the read never sees. (Tried it: it reported the read
// getting a third of them wrong, all of it work the read is never asked to do.)
//
// Ground truth here is the shop's own merchandising. A piece sitting in a
// "Mens" collection whose product type, tags, title and handle say nothing
// about gender is exactly the piece this read exists for, and the shop itself
// says which way it goes.
//
// Two failures, and they cost different things:
//
//   men read as women   menswear reaches her queue — the failure that made this
//                       read use the strong model in the first place
//   women read as men   good womenswear silently dropped before she ever sees it
//
//   node_modules/.bin/jiti scripts/bench-gender-read.ts
//   node_modules/.bin/jiti scripts/bench-gender-read.ts --variants=luna-low,luna-high
//   node_modules/.bin/jiti scripts/bench-gender-read.ts --per=20 --concurrency=3

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { MEN_RE, WOMEN_RE } from '../src/lib/brand-watch-gender'

const arg = (n: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=')
const flag = (n: string): boolean => process.argv.includes(`--${n}`)

const CACHE_FILE = path.join(process.cwd(), 'scripts', '.eval', 'gender-bench.json')

// Same prompt as src/app/admin/ai/classify-gender.ts. The bench must test the
// prompt that would ship, not a paraphrase of it.
const PROMPT = `Is this fashion product WOMEN'S or MEN'S wear?

Answer with exactly one word: women, men, or unclear.

How to decide, in order:
1. If a person is shown, judge THEM — face, body, hair, build — even if the
   shot is cropped to the torso or legs. A male model means "men", whatever
   the styling. Contemporary menswear is often loose, pastel and androgynous;
   do not read that as womenswear.
2. With no person, judge the garment's cut: bust darts, a nipped waist, a
   women's button side, narrow shoulders and a shaped body mean "women";
   a straight boxy body, wide shoulders and a men's placket mean "men".
3. If you genuinely cannot tell, answer "unclear". Do not guess.`

/** USD per million tokens, from src/lib/wardrobe/cost.ts. */
const PRICE: Record<string, [number, number]> = {
  'gpt-6-luna': [0.2, 1.2],
  'gpt-5.6-luna': [0.2, 1.2],
  'gpt-5.6-terra': [2, 12],
  'gpt-5.6-sol': [4, 20],
  'gpt-6.1-sol': [4, 20],
}

interface Variant { label: string; model: string; detail: 'low' | 'high' }
const VARIANTS: Variant[] = [
  // The candidate, at both detail levels: ivory against cream needed high detail
  // for the colour read, and the same question applies to a garment's cut.
  { label: 'luna-low', model: 'gpt-6-luna', detail: 'low' },
  { label: 'luna-high', model: 'gpt-6-luna', detail: 'high' },
  // What the strong-model read costs. Not a candidate at volume: here to answer
  // whether the cheap tiers are losing anything a bigger reader would catch.
  { label: 'terra-low', model: 'gpt-5.6-terra', detail: 'low' },
  { label: 'sol-low', model: 'gpt-6.1-sol', detail: 'low' },
]

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

interface Case { brand: string; label: 'men' | 'women'; name: string; image: string; from: string; group: Group }

/**
 * Whether this piece's gender is even a question.
 *
 * Read the first pass without this and the "menswear leaking in" list was
 * keyrings, match boxes, scarves and socks — merchandise that has no gender at
 * all, filed in a men's collection because that is where the shop put it. A
 * leather keyring read as womenswear is not menswear reaching her queue, and
 * counting it as one buries the failure that does matter: a men's coat read as
 * womenswear. Only garments and footwear are scored.
 */
type Group = 'garment' | 'footwear' | 'accessory'

const ACCESSORY = /\b(bag|bags|tote|purse|pouch|wallet|cardholder|card holder|keyring|key ring|keychain|charm|scarf|scarves|snood|foulard|stole|shawl|sock|socks|tights|hat|hats|cap|caps|beanie|beret|headband|belt|belts|glove|gloves|mitten|jewel|jewellery|jewelry|necklace|pendant|bracelet|bangle|earring|earrings|ring|brooch|pin|sunglass|sunglasses|glasses|eyewear|optic|tie|ties|bow tie|matches|matchbox|box|holder|case|cover|strap|candle|fragrance|perfume|badge|umbrella|towel|blanket|throw|cushion|watch|pillow|mirror|comb|brush|water bottle|flask|mug|cup)\b/i
const FOOTWEAR = /\b(shoe|shoes|sneaker|sneakers|boot|boots|loafer|loafers|sandal|sandals|derby|derbies|moccasin|moccasins|slipper|slippers|heel|heels|pump|pumps|espadrille|espadrilles|trainer|trainers)\b/i

function groupOf(handle: string, title: string): Group {
  const hay = `${handle} ${title}`
  if (ACCESSORY.test(hay)) return 'accessory'
  if (FOOTWEAR.test(hay)) return 'footwear'
  return 'garment'
}

/** What the feed says about gender, on the fields the scan reads. */
function labelOf(productType: string, tags: string[], title: string, handle: string): 'men' | 'women' | null {
  const hay = [productType, tags.join(' '), title, handle].join(' ')
  const men = MEN_RE.test(hay)
  const women = WOMEN_RE.test(hay)
  if (men === women) return null
  return men ? 'men' : 'women'
}

const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh) MYRA-BrandWatch/1.0' }

async function getJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, { headers: UA })
    if (!res.ok) return null
    return await res.json()
  } catch { return null }
}

/**
 * The shop's own gendered collections.
 *
 * Deliberately NOT MEN_RE/WOMEN_RE: those carry season codes (mss26, waw25),
 * which name a collection's season rather than the people it is cut for, and a
 * store whose collection list is all season codes would become a fabricated
 * ground truth. Here a collection counts only if it says the word.
 *
 * "Men & Unisex" is skipped too: unisex pieces would be scored against a rule
 * that does not apply to them, and a wrong label is worse than a small sample.
 */
async function genderedCollections(base: string): Promise<{ men: string[]; women: string[] }> {
  const WORD_MEN = /\b(men|mens|men's|man|homme|hommes|herren|uomo|hombre)\b/i
  const WORD_WOMEN = /\b(women|womens|women's|woman|femme|femmes|ladies|damen|donna|mujer)\b/i
  const j = await getJson(`${base}/collections.json?limit=250`)
  const men: string[] = []
  const women: string[] = []
  for (const c of j?.collections ?? []) {
    const hay = `${c.handle ?? ''} ${c.title ?? ''}`
    if (/unisex|everyone|all\b/i.test(hay)) continue
    const isMen = WORD_MEN.test(hay)
    const isWomen = WORD_WOMEN.test(hay)
    if (isMen === isWomen) continue
    ;(isMen ? men : women).push(c.handle)
  }
  return { men, women }
}

async function collectionProducts(base: string, handle: string): Promise<any[]> {
  const out: any[] = []
  for (let page = 1; page <= 3; page++) {
    const j = await getJson(`${base}/collections/${handle}/products.json?limit=250&page=${page}`)
    const batch = j?.products ?? []
    out.push(...batch)
    if (batch.length < 250) break
  }
  return out
}

async function gather(perBrand: number): Promise<Case[]> {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string,
    { auth: { persistSession: false } },
  )
  const { data: brands } = await db.from('watched_brand')
    .select('name, base_url').eq('platform', 'shopify').eq('active', true)
  const cases: Case[] = []
  for (const b of brands ?? []) {
    const cols = await genderedCollections(b.base_url)
    if (!cols.men.length && !cols.women.length) continue
    // Both sides, so the read is tested on the men's pieces it must catch AND
    // the women's pieces it must not throw away.
    const men: Case[] = []
    const women: Case[] = []
    for (const [label, handles] of [['men', cols.men], ['women', cols.women]] as const) {
      const seen = new Set<string>()
      for (const handle of handles) {
        for (const p of await collectionProducts(b.base_url, handle)) {
          const id = String(p.id ?? '')
          if (!id || seen.has(id)) continue
          seen.add(id)
          const image = p.images?.[0]?.src
          if (!image) continue
          // Only pieces the feed is SILENT about. Anything the scan can decide
          // for free never reaches the image read, so it proves nothing here.
          if (labelOf(p.product_type ?? '', p.tags ?? [], String(p.title ?? ''), String(p.handle ?? ''))) continue
          ;(label === 'men' ? men : women).push({
            brand: b.name, label, from: handle,
            group: groupOf(handle, String(p.title ?? '')),
            name: String(p.title ?? '').slice(0, 46), image,
          })
        }
      }
    }
    cases.push(...men.slice(0, perBrand), ...women.slice(0, perBrand))
    if (men.length || women.length) {
      console.log(`  ${b.name}: ${men.length} men's, ${women.length} women's with no gender in the feed`)
      if (flag('collections')) console.log(`     men's from ${cols.men.join(', ') || '—'}\n     women's from ${cols.women.join(', ') || '—'}`)
    }
  }
  return cases
}

type Read = 'women' | 'men' | 'unclear' | 'error'
interface Answer { read: Read; usd: number; error?: string }

async function readOne(key: string, v: Variant, image: string): Promise<Answer> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: v.model,
          max_completion_tokens: 8,
          ...(v.model.startsWith('gpt-6') ? { reasoning_effort: 'none' } : {}),
          messages: [{
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: image, detail: v.detail } },
              { type: 'text', text: PROMPT },
            ],
          }],
        }),
      })
      const j: any = await res.json().catch(() => ({}))
      // A rate limit is not an answer about a garment. Wait it out rather than
      // recording a failure that would flatter whichever variant ran first.
      if (res.status === 429 && attempt < 3) {
        await new Promise((r) => setTimeout(r, 20_000 * (attempt + 1)))
        continue
      }
      if (!res.ok) {
        return { read: 'error', usd: 0, error: `HTTP ${res.status}: ${String(j?.error?.message ?? '').slice(0, 90)}` }
      }
      const u = j.usage ?? {}
      const [pi, po] = PRICE[v.model] ?? [0.2, 1.2]
      const word = String(j.choices?.[0]?.message?.content ?? '').trim().toLowerCase()
      const read: Read = word.startsWith('women') ? 'women' : word.startsWith('men') ? 'men' : 'unclear'
      return { read, usd: ((u.prompt_tokens ?? 0) * pi + (u.completion_tokens ?? 0) * po) / 1e6 }
    } catch (err) {
      if (attempt === 3) return { read: 'error', usd: 0, error: err instanceof Error ? err.message : 'fetch failed' }
      await new Promise((r) => setTimeout(r, 3_000))
    }
  }
  return { read: 'error', usd: 0, error: 'gave up after rate limits' }
}

async function main() {
  const env = readEnv()
  for (const [k, v] of Object.entries(env)) if (process.env[k] === undefined) process.env[k] = v
  const key = env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY must be in .env.local')

  const perBrand = Number(arg('per') ?? 12)
  const conc = Number(arg('concurrency') ?? 3)
  const wanted = (arg('variants') ?? VARIANTS.map((v) => v.label).join(',')).split(',').map((s) => s.trim())
  const variants = VARIANTS.filter((v) => wanted.includes(v.label))

  console.log('ground truth, from the feeds themselves:')
  const cases = await gather(perBrand)
  const menCount = cases.filter((c) => c.label === 'men').length
  console.log(`\n${cases.length} pieces (${menCount} men's, ${cases.length - menCount} women's)\n`)
  if (!cases.length) throw new Error('no labelled pieces found — nothing to measure')

  const cache: Record<string, Answer> = fs.existsSync(CACHE_FILE)
    ? JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'))
    : {}

  for (const v of variants) {
    let done = 0
    const answers: Answer[] = new Array(cases.length)
    let next = 0
    await Promise.all(Array.from({ length: conc }, async () => {
      while (next < cases.length) {
        const i = next++
        const ck = `${v.label}|${cases[i].image}`
        if (cache[ck]) { answers[i] = cache[ck] } else {
          answers[i] = await readOne(key, v, cases[i].image)
          // Cache only real answers: a rate limit must not become a permanent
          // "error" on the next run.
          if (answers[i].read !== 'error') cache[ck] = answers[i]
        }
        done++
        if (done % 25 === 0) process.stdout.write(`  ${v.label}: ${done}/${cases.length}\n`)
      }
    }))
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true })
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 0))

    const total = answers.reduce((s, a) => s + (a?.usd ?? 0), 0)
    const scored = answers.map((a, i) => ({ a, c: cases[i] }))
    const men = scored.filter(({ c }) => c.label === 'men')
    const women = scored.filter(({ c }) => c.label === 'women')
    const read = (rows: typeof scored, r: Read) => rows.filter(({ a }) => a.read === r)
    const errors = scored.filter(({ a }) => a.read === 'error')
    // Percentages are over the SUBSET they describe. Over all pieces they
    // understate both failures by half, which is the wrong way to be wrong
    // about a read that decides what reaches her.
    const pct = (n: number, of: number) => `${Math.round((n / of) * 100)}%`

    // Only garments and footwear decide this. See groupOf.
    const scoredClothes = scored.filter(({ c }) => c.group !== 'accessory')
    const menC = scoredClothes.filter(({ c }) => c.label === 'men')
    const womenC = scoredClothes.filter(({ c }) => c.label === 'women')
    const accessories = scored.filter(({ c }) => c.group === 'accessory')

    // The two routes act on the answer differently, so the same reading costs
    // them different things. Shopify excludes only a POSITIVE men's read, so an
    // unclear answer there is harmless. The browser route keeps only a positive
    // WOMEN's read, so an unclear answer there drops the piece.
    console.log(`\n── ${v.label}  (${v.model}, detail ${v.detail})`)
    console.log(`   men's CLOTHES (${menC.length}): read men ${read(menC, 'men').length} · read WOMEN (leak) ${read(menC, 'women').length} ${pct(read(menC, 'women').length, menC.length)} · unclear ${read(menC, 'unclear').length}`)
    console.log(`   women's CLOTHES (${womenC.length}): read women ${read(womenC, 'women').length} · read MEN (dropped) ${read(womenC, 'men').length} ${pct(read(womenC, 'men').length, womenC.length)} · unclear ${read(womenC, 'unclear').length}`)
    console.log(`   errors     ${errors.length}${errors.length ? ` (${errors[0].a.error})` : ''}`)
    // The two routes act on the answer differently, so the same reading costs
    // them different things. Shopify excludes only a POSITIVE men's read, so an
    // unclear answer there is harmless and the leak is the whole story. The
    // browser route keeps only a positive WOMEN's read, so an unclear answer
    // there drops the piece.
    const shopifyLeak = read(menC, 'women').length
    const shopifyDropped = read(womenC, 'men').length
    const browserLeak = shopifyLeak
    const browserDropped = womenC.length - read(womenC, 'women').length
    console.log(`   SHOPIFY route  menswear leaking in ${shopifyLeak}/${menC.length} ${pct(shopifyLeak, menC.length)} · womenswear dropped ${shopifyDropped}/${womenC.length} ${pct(shopifyDropped, womenC.length)}`)
    console.log(`   BROWSER route  menswear leaking in ${browserLeak}/${menC.length} ${pct(browserLeak, menC.length)} · womenswear dropped ${browserDropped}/${womenC.length} ${pct(browserDropped, womenC.length)}`)
    console.log(`   (accessories, ${accessories.length}, not scored: a keyring has no gender)`)
    if (flag('leaks')) {
      for (const { a, c } of menC.filter(({ a }) => a.read === 'women')) {
        console.log(`     LEAK ${c.brand} / ${c.name}\n          ${c.image}`)
      }
    }
    // Per brand, because an average hides the failure that matters: one brand
    // whose menswear all reads as womenswear is how a whole queue of men's
    // pieces got in before, and it would barely move a headline number.
    const byBrand = new Map<string, { men: number; leak: number; women: number; drop: number }>()
    for (const { a, c } of scoredClothes) {
      const b = byBrand.get(c.brand) ?? { men: 0, leak: 0, women: 0, drop: 0 }
      if (c.label === 'men') { b.men++; if (a.read === 'women') b.leak++ } else { b.women++; if (a.read === 'men') b.drop++ }
      byBrand.set(c.brand, b)
    }
    const worst = Array.from(byBrand.entries())
      .filter(([, b]) => b.men >= 3 || b.women >= 3)
      .map(([name, b]) => ({ name, ...b, score: b.leak + b.drop }))
      .sort((x, y) => y.score - x.score)
      .slice(0, 6)
    console.log(`   worst brands  ${worst.map((w) => `${w.name} ${w.leak}/${w.men} men leaked, ${w.drop}/${w.women} women dropped`).join(' · ') || '—'}`)
    console.log(`   cost       $${(total / cases.length).toFixed(6)} a read — $${((total / cases.length) * 1000).toFixed(2)} per 1,000`)

    // The names it got wrong, kept as evidence rather than a summary: whether a
    // miss is a male model misread (the failure that ruled out Haiku) or a
    // flat-lay nobody could call is a question for the eye, not the tally.
    const dump = {
      variant: v.label, model: v.model, detail: v.detail,
      wrong: scored.filter(({ a, c }) => a.read !== c.label && a.read !== 'error')
        .map(({ a, c }) => ({ said: c.label, read: a.read, brand: c.brand, name: c.name, image: c.image })),
    }
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true })
    fs.writeFileSync(path.join(path.dirname(CACHE_FILE), `gender-bench-${v.label}.json`), JSON.stringify(dump, null, 2))
  }
  console.log(`\ncache: ${CACHE_FILE} (re-runs are free; delete it to re-measure)`)
}

main().catch((e) => { console.error(e instanceof Error ? e.stack : e); process.exit(1) })
