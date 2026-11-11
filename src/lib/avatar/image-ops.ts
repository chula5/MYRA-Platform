// Pixel work for the avatar: magenta masks, the head transplant, and the checks.
// Everything here is sharp on buffers; no model calls.

import 'server-only'

// Next hands back the ESM default; a plain Node/jiti load hands back the module itself.
async function sharp() { const m: any = await import('sharp'); return (m.default ?? m) as typeof import('sharp').default }

export interface Raw { data: Buffer; width: number; height: number; channels: number }

export async function toRaw(png: Buffer, width?: number, height?: number): Promise<Raw> {
  const s = await sharp()
  let img = s(png).removeAlpha()
  if (width && height) img = img.resize(width, height, { fit: 'fill' })
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height, channels: info.channels }
}

export async function dims(png: Buffer): Promise<{ width: number; height: number }> {
  const m = await (await sharp())(png).metadata()
  return { width: m.width ?? 0, height: m.height ?? 0 }
}

export async function toJpeg(png: Buffer, maxWidth = 1200, quality = 90): Promise<Buffer> {
  return (await sharp())(png).resize({ width: maxWidth, withoutEnlargement: true }).jpeg({ quality }).toBuffer()
}

/** Where the model painted magenta: a 0/255 mask plus its bounding box. */
export function magentaMask(r: Raw): { mask: Uint8Array; count: number; bbox: { x0: number; y0: number; x1: number; y1: number } | null } {
  const N = r.width * r.height
  const m = new Uint8Array(N)
  let count = 0, x0 = r.width, y0 = r.height, x1 = -1, y1 = -1
  for (let i = 0; i < N; i++) {
    const R = r.data[i * r.channels], G = r.data[i * r.channels + 1], B = r.data[i * r.channels + 2]
    if (R > 150 && B > 150 && G < 110 && R - G > 90 && B - G > 90) {
      m[i] = 255; count++
      const x = i % r.width, y = (i / r.width) | 0
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y
    }
  }
  return { mask: m, count, bbox: count ? { x0, y0, x1, y1 } : null }
}

/** Blur-and-threshold: closes pinholes and drops specks. */
export async function smoothMask(mask: Uint8Array, width: number, height: number, sigma: number, cut: number): Promise<Uint8Array> {
  const s = await sharp()
  const b = await s(Buffer.from(mask), { raw: { width, height, channels: 1 } }).blur(sigma).raw().toBuffer()
  const ch = b.length / (width * height)
  const o = new Uint8Array(width * height)
  for (let i = 0; i < o.length; i++) o[i] = b[i * ch] > cut ? 255 : 0
  return o
}

/**
 * Fill every hole the mask does not reach from the picture's edge. The model marks a
 * garment by colour, so the cream flowers on navy trousers, a pale stripe or a light
 * button band come back unmarked and the cut-out had windows showing her bare legs
 * through the print (2026-11-09). A real gap — between two trouser legs, inside an open
 * front, under a hem — always connects to the background and so to the edge; only an
 * island inside the garment is filled.
 */
export function fillEnclosedHoles(mask: Uint8Array, width: number, height: number): Uint8Array {
  const N = width * height
  const reach = new Uint8Array(N) // 1 = clear pixel connected to the edge
  const stack: number[] = []
  const push = (i: number) => { if (!reach[i] && !mask[i]) { reach[i] = 1; stack.push(i) } }
  for (let x = 0; x < width; x++) { push(x); push((height - 1) * width + x) }
  for (let y = 0; y < height; y++) { push(y * width); push(y * width + width - 1) }
  while (stack.length) {
    const i = stack.pop()!
    const x = i % width
    if (x > 0) push(i - 1)
    if (x < width - 1) push(i + 1)
    if (i >= width) push(i - width)
    if (i + width < N) push(i + width)
  }
  const out = new Uint8Array(mask)
  for (let i = 0; i < N; i++) if (!mask[i] && !reach[i]) out[i] = 255
  return out
}

/**
 * Shoes replace her feet, not just cover them. A shoe layer cut to the shoe alone sat on
 * the base's bare feet, and wherever the drawn shoe was narrower, shorter or placed
 * differently the bare toes and heels showed around it (every pair, 2026-11-09). So the
 * layer takes the whole lower band of the shot — shoes, feet, ankles and the flat stage
 * floor around them — from a little above the top of the shoes down to the bottom edge,
 * across the legs' span with room either side, feathered along its top edge.
 */
export function extendToFloor(mask: Uint8Array, width: number, height: number): Uint8Array {
  let y0 = height, x0 = width, x1 = -1
  for (let i = 0; i < mask.length; i++) if (mask[i]) { const y = (i / width) | 0, x = i % width; if (y < y0) y0 = y; if (x < x0) x0 = x; if (x > x1) x1 = x }
  if (x1 < 0) return mask
  const pad = Math.max(80, Math.round((x1 - x0) * 0.6))
  const left = Math.max(0, x0 - pad), right = Math.min(width - 1, x1 + pad)
  const top = Math.max(0, y0 - 14)
  const feather = 28
  const out = new Uint8Array(mask)
  for (let y = top; y < height; y++) {
    const a = y - top >= feather ? 255 : Math.round(255 * (y - top) / feather)
    for (let x = left; x <= right; x++) { const i = y * width + x; if (out[i] < a) out[i] = a }
  }
  return out
}

/**
 * A piece worn OPEN by itself (an unbuttoned cardigan) keeps whatever the shot shows
 * between its two fronts — the model marks the knit and leaves the V of skin out, and
 * the base's grey tank then showed through the gap (2026-11-09). Row by row, from the
 * garment's centre line outwards to the first marked pixel each side; when both fronts
 * are found within the garment's width the span between them is kept. The gaps between
 * a sleeve and the body are left alone (they are not reached from the centre line).
 */
export function closeFront(mask: Uint8Array, width: number, height: number, img?: Raw): Uint8Array {
  let x0 = width, x1 = -1, y0 = height, y1 = -1
  for (let i = 0; i < mask.length; i++) if (mask[i]) { const x = i % width, y = (i / width) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  if (x1 < 0) return mask
  const cx = (x0 + x1) >> 1
  const reach = Math.round((x1 - x0) * 0.35)
  // Below the hem the two SLEEVES bound the centre line instead of the fronts, and the
  // span between them is her shorts and midriff: the gap there is far wider than any
  // opening between two fronts. The first row whose gap exceeds a fifth of the garment's
  // width, after the fill has begun, is the hem — nothing below it is filled.
  const maxGap = Math.round((x1 - x0) * 0.2)
  const out = new Uint8Array(mask)
  let filled = false
  for (let y = y0; y <= y1; y++) {
    const row = y * width
    if (mask[row + cx]) continue
    let l = cx, r = cx
    while (l > x0 && !mask[row + l] && cx - l < reach) l--
    while (r < x1 && !mask[row + r] && r - cx < reach) r++
    if (!mask[row + l] || !mask[row + r]) continue
    if (r - l > maxGap) { if (filled) break; continue }
    // Between the fronts the shot shows her skin, and below the waist the base's grey
    // shorts. The shorts must not travel in the layer (they would cover a skirt worn
    // under an open cardigan), so the fill ends where the span stops being skin: warm
    // (red well above blue) rather than the shorts' neutral grey.
    if (img && filled) {
      let warm = 0, n = 0
      for (let x = l + 1; x < r; x++) { const i = (row + x) * img.channels; warm += img.data[i] - img.data[i + 2]; n++ }
      if (n > 0 && warm / n < 12) break
    }
    filled = true
    for (let x = l; x <= r; x++) out[row + x] = 255
  }
  return out
}

/**
 * The base wears a grey tank and grey cycling shorts. A piece shorter than they are —
 * cream shorts above mid-thigh, a cropped top — is drawn by the model with her skin where
 * the grey used to be, but the layer, cut to the piece alone, left the base's grey
 * showing below it (Chloe, 2026-11-09: "these shorts should not be appearing like that").
 * Wherever the BASE is neutral light grey (its tank or shorts) and the SHOT shows warm
 * skin there, that skin joins the layer, so it covers the grey it replaced.
 */
export function uncoveredBase(mask: Uint8Array, shot: Raw, base: Raw): Uint8Array {
  const out = new Uint8Array(mask)
  const N = shot.width * shot.height
  for (let i = 0; i < N; i++) {
    if (out[i]) continue
    const b = i * base.channels, bR = base.data[b], bG = base.data[b + 1], bB = base.data[b + 2]
    const greyBase = Math.abs(bR - bG) < 14 && Math.abs(bG - bB) < 14 && bR > 120 && bR < 225
    if (!greyBase) continue
    const sIdx = i * shot.channels, sR = shot.data[sIdx], sB = shot.data[sIdx + 2]
    if (sR > 110 && sR - sB > 18) out[i] = 255
  }
  return out
}

/** The dressed pixels under a mask, as a webp with alpha. */
export async function cutLayer(dressedPng: Buffer, maskPng: Buffer, opts: { toFloor?: boolean; fillHoles?: boolean; closeFront?: boolean; basePng?: Buffer } = {}): Promise<{ webp: Buffer; width: number; height: number; coverage: number }> {
  const s = await sharp()
  const img = await toRaw(dressedPng)
  const mk = await toRaw(maskPng, img.width, img.height)
  const { mask, count } = magentaMask(mk)
  const N = img.width * img.height
  let sm = await smoothMask(mask, img.width, img.height, 2, 120)
  if (opts.basePng) {
    const base = await toRaw(opts.basePng, img.width, img.height)
    sm = await smoothMask(uncoveredBase(sm, img, base), img.width, img.height, 1.5, 120)
  }
  if (opts.fillHoles !== false) sm = fillEnclosedHoles(sm, img.width, img.height)
  if (opts.closeFront) sm = closeFront(sm, img.width, img.height, img)
  if (opts.toFloor) sm = extendToFloor(sm, img.width, img.height)
  const alphaBuf = await s(Buffer.from(sm), { raw: { width: img.width, height: img.height, channels: 1 } }).blur(1.4).raw().toBuffer()
  const ach = alphaBuf.length / N
  const rgba = Buffer.alloc(N * 4)
  for (let i = 0; i < N; i++) {
    rgba[i * 4] = img.data[i * img.channels]; rgba[i * 4 + 1] = img.data[i * img.channels + 1]; rgba[i * 4 + 2] = img.data[i * img.channels + 2]
    rgba[i * 4 + 3] = alphaBuf[i * ach]
  }
  const webp = await s(rgba, { raw: { width: img.width, height: img.height, channels: 4 } }).webp({ quality: 90, alphaQuality: 92 }).toBuffer()
  return { webp, width: img.width, height: img.height, coverage: count / N }
}

/**
 * Where a top underneath a worn jacket may show: the jacket's central opening, plus every
 * row the jacket does not reach. Returns a small webp with alpha for CSS mask-image.
 */
export async function openingMask(layerWebp: Buffer, extraCoverWebp?: Buffer): Promise<Buffer> {
  const s = await sharp()
  const { data, info } = await s(layerWebp).raw().toBuffer({ resolveWithObject: true })
  const W = info.width, H = info.height, ch = info.channels
  const a = new Uint8Array(W * H)
  for (let i = 0; i < W * H; i++) a[i] = data[i * ch + ch - 1]
  if (extraCoverWebp) {
    const e = await s(extraCoverWebp).resize(W, H, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true })
    for (let i = 0; i < W * H; i++) if (e.data[i * e.info.channels + e.info.channels - 1] > 128) a[i] = 255
  }
  const out = Buffer.alloc(W * H, 0)
  const cx = W >> 1
  for (let y = 0; y < H; y++) {
    const row = y * W
    let any = false
    for (let x = 0; x < W; x++) if (a[row + x] > 128) { any = true; break }
    if (!any) { out.fill(255, row, row + W); continue }
    if (a[row + cx] > 128) continue
    let l = cx, r = cx
    while (l > 0 && a[row + l - 1] <= 128) l--
    while (r < W - 1 && a[row + r + 1] <= 128) r++
    out.fill(255, row + l, row + r + 1)
  }
  const soft = await s(out, { raw: { width: W, height: H, channels: 1 } }).blur(1.5).raw().toBuffer()
  const sch = soft.length / (W * H)
  const rgba = Buffer.alloc(W * H * 4)
  for (let i = 0; i < W * H; i++) { rgba[i * 4] = 255; rgba[i * 4 + 1] = 255; rgba[i * 4 + 2] = 255; rgba[i * 4 + 3] = soft[i * sch] }
  return s(rgba, { raw: { width: W, height: H, channels: 4 } }).resize(Math.round(W / 4), Math.round(H / 4)).webp({ quality: 80, alphaQuality: 90 }).toBuffer()
}

/**
 * Put the portrait's head on the body: both heads marked magenta by the model, the portrait
 * head scaled so the head boxes match, pasted at the body head's position with a feathered
 * edge. A harmonising pass follows; this only has to get it roughly right.
 */
export async function transplantHead(bodyPng: Buffer, bodyMaskPng: Buffer, portraitPng: Buffer, portraitMaskPng: Buffer): Promise<Buffer> {
  const s = await sharp()
  const body = await dims(bodyPng)
  const bm = magentaMask(await toRaw(bodyMaskPng, body.width, body.height))
  const portrait = await dims(portraitPng)
  const pmRaw = await toRaw(portraitMaskPng, portrait.width, portrait.height)
  const pm = magentaMask(pmRaw)
  if (!bm.bbox || !pm.bbox) throw new Error('head mask missing')
  const scale = (bm.bbox.y1 - bm.bbox.y0) / (pm.bbox.y1 - pm.bbox.y0)
  const w = Math.round(portrait.width * scale), h = Math.round(portrait.height * scale)
  const alpha = await s(Buffer.from(await smoothMask(pm.mask, portrait.width, portrait.height, 2, 120)), { raw: { width: portrait.width, height: portrait.height, channels: 1 } }).blur(3).resize(w, h).raw().toBuffer({ resolveWithObject: true })
  const head = await s(portraitPng).resize(w, h).removeAlpha().raw().toBuffer()
  const N = w * h, ach = alpha.info.channels
  const rgba = Buffer.alloc(N * 4)
  for (let i = 0; i < N; i++) { rgba[i * 4] = head[i * 3]; rgba[i * 4 + 1] = head[i * 3 + 1]; rgba[i * 4 + 2] = head[i * 3 + 2]; rgba[i * 4 + 3] = alpha.data[i * ach] }
  const headPng = await s(rgba, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer()
  const pcx = ((pm.bbox.x0 + pm.bbox.x1) / 2) * scale, pty = pm.bbox.y0 * scale
  const bcx = (bm.bbox.x0 + bm.bbox.x1) / 2, bty = bm.bbox.y0
  return s(bodyPng).composite([{ input: headPng, left: Math.round(bcx - pcx), top: Math.round(bty - pty) }]).png().toBuffer()
}

/**
 * Checks before a member sees her avatar. Cheap and pixel-based; the aim is to catch the
 * failures seen in the sandbox: a street background bleeding in, a head out of proportion.
 */
export async function avatarChecks(png: Buffer, headMaskPng?: Buffer): Promise<{ ok: boolean; reasons: string[] }> {
  const reasons: string[] = []
  const r = await toRaw(png)
  // 1. flat background: the four corners should be the stage grey and agree with each other
  const sample = (x: number, y: number) => { const i = (y * r.width + x) * r.channels; return [r.data[i], r.data[i + 1], r.data[i + 2]] }
  const corners = [sample(20, 20), sample(r.width - 21, 20), sample(20, Math.round(r.height * 0.35)), sample(r.width - 21, Math.round(r.height * 0.35))]
  const target = [0xE4, 0xE2, 0xDD]
  const far = corners.filter((c) => Math.abs(c[0] - target[0]) + Math.abs(c[1] - target[1]) + Math.abs(c[2] - target[2]) > 60)
  if (far.length) reasons.push('background is not the plain studio grey')
  // 2. head in proportion: head height between 10% and 17% of the frame
  if (headMaskPng) {
    const hm = magentaMask(await toRaw(headMaskPng, r.width, r.height))
    if (hm.bbox) {
      const headH = (hm.bbox.y1 - hm.bbox.y0) / r.height
      if (headH > 0.22) reasons.push('head too large for the body')
      if (headH < 0.08) reasons.push('head too small for the body')
      if (hm.bbox.y0 < 8) reasons.push('head cut off at the top')
    }
  }
  return { ok: reasons.length === 0, reasons }
}
