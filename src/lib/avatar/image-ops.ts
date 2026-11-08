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

/** The dressed pixels under a mask, as a webp with alpha. */
export async function cutLayer(dressedPng: Buffer, maskPng: Buffer): Promise<{ webp: Buffer; width: number; height: number; coverage: number }> {
  const s = await sharp()
  const img = await toRaw(dressedPng)
  const mk = await toRaw(maskPng, img.width, img.height)
  const { mask, count } = magentaMask(mk)
  const N = img.width * img.height
  const sm = await smoothMask(mask, img.width, img.height, 2, 120)
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
