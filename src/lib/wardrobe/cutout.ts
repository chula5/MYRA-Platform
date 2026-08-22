// Stage 2 — CUTOUT. Pure image maths (sharp) + the generation prompt.
//
// The reference pipeline generates each garment on a chroma key and strips it;
// MYRA's retail item images are product shots on white, so we ask for white
// directly — prompt conventions follow the white-background-cutout skill
// ("clean, pure white background… keep every detail exactly the same… studio
// lighting, natural shadow grounding") rewritten for a garment with no wearer —
// then frame the result on a 3:4 white canvas so an owned piece sits next to a
// retail one in review cards and lookbooks without looking like a different
// kind of image.

import sharp from 'sharp'
import type { DetectedGarment } from './types'

/** Upright sRGB PNG, capped so the vision/image APIs never reject on size. */
export async function normalisePhoto(bytes: Buffer, maxEdge = 2048): Promise<{ png: Buffer; width: number; height: number }> {
  const png = await sharp(bytes).rotate().resize(maxEdge, maxEdge, { fit: 'inside', withoutEnlargement: true }).toColorspace('srgb').png().toBuffer()
  const meta = await sharp(png).metadata()
  return { png, width: meta.width ?? 0, height: meta.height ?? 0 }
}

/** Small JPEG for the detector — detection doesn't need full resolution. */
export async function detectorJpeg(bytes: Buffer, maxEdge = 1536): Promise<Buffer> {
  return sharp(bytes).rotate().resize(maxEdge, maxEdge, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer()
}

/** Padded crop of one detected garment (box in 0..1000 coords), as PNG. */
export async function cropGarment(normalisedPng: Buffer, box: DetectedGarment['bounding_box'], pad = 0.1): Promise<Buffer> {
  const meta = await sharp(normalisedPng).metadata()
  const W = meta.width ?? 1
  const H = meta.height ?? 1
  const rawLeft = (box.x / 1000) * W
  const rawTop = (box.y / 1000) * H
  const rawW = (box.width / 1000) * W
  const rawH = (box.height / 1000) * H
  const padding = Math.max(12, Math.round(Math.max(rawW, rawH) * pad))
  const left = Math.max(0, Math.floor(rawLeft - padding))
  const top = Math.max(0, Math.floor(rawTop - padding))
  const right = Math.min(W, Math.ceil(rawLeft + rawW + padding))
  const bottom = Math.min(H, Math.ceil(rawTop + rawH + padding))
  return sharp(normalisedPng)
    .extract({ left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) })
    .png()
    .toBuffer()
}

export function buildCutoutPrompt(g: DetectedGarment, direction?: string | null): string {
  const colour = g.colour_hex ? `${g.colour_family ?? 'the visible colour'} (${g.colour_hex})` : g.colour_family ?? 'the exact visible colour'
  const material = g.material_guess ? `, ${g.material_guess}` : ''
  const pattern = g.pattern && g.pattern !== 'none' ? `, ${g.pattern} pattern` : ''
  const silhouette = g.silhouette ? ` Silhouette: ${g.silhouette}.` : ''
  const base = `Use case: e-commerce product cutout.

The reference photograph shows this exact ${g.name} (${g.item_type.replace(/_/g, ' ')}), possibly worn by a person among other garments. Use it only to identify and reconstruct that one item.

Produce a clean, front-facing product photograph of ONLY the complete, empty ${g.name} on a pure white (#FFFFFF) seamless studio background. If a wearer is present, remove them entirely — no body, skin, hair, hands, mannequin or hanger. Remove every other garment, accessory, prop and background element. Lay the item out naturally and symmetrically the way a retailer would photograph it, centred, with generous even white margin on every side; nothing cropped.

Keep the item exactly the same: ${colour}${material}${pattern}, texture, construction, neckline, sleeves, closures, hem, proportions and any clearly legible existing logo or print.${silhouette} Visible detail: ${g.description} Do not invent or reinterpret uncertain logos, text, pockets, seams, hardware, colours or trim — prefer omission over invention.

Lighting: soft, even studio product lighting, fashion-editorial, with a faint natural contact shadow beneath the piece for grounding. No cast shadows on the background, no gradient, no vignette, no reflection, no text, no watermark, no border.`
  return direction && direction.trim()
    ? `${base}\n\nReviewer's correction for this regeneration: ${direction.trim().slice(0, 600)}`
    : base
}

/**
 * Flatten whatever the model returned onto white and frame it on a 3:4 canvas
 * (1024×1365) with the garment occupying at most 86% of the short edge — the
 * same visual grammar as the retail item images.
 */
export async function frameOnWhite(pngBytes: Buffer, width = 1024, height = 1365, occupancy = 0.86): Promise<Buffer> {
  const flat = await sharp(pngBytes).flatten({ background: '#ffffff' }).png().toBuffer()
  // Trim the white margin the model added (tolerant threshold), then re-pad.
  let trimmed = flat
  try {
    trimmed = await sharp(flat).trim({ background: '#ffffff', threshold: 18 }).png().toBuffer()
  } catch { /* nothing to trim */ }
  const target = Math.round(width * occupancy)
  const resized = await sharp(trimmed)
    .resize(target, Math.round(height * occupancy), { fit: 'inside', withoutEnlargement: false })
    .png()
    .toBuffer({ resolveWithObject: true })
  const left = Math.floor((width - resized.info.width) / 2)
  const top = Math.floor((height - resized.info.height) / 2)
  return sharp({ create: { width, height, channels: 3, background: '#ffffff' } })
    .composite([{ input: resized.data, left, top }])
    .jpeg({ quality: 92 })
    .toBuffer()
}

/**
 * Cheap sanity check on a generated cutout: the border must be (near) white
 * and there must be something non-white in the middle. Returns a reason when
 * the image should be regenerated automatically.
 */
export async function cutoutLooksValid(pngBytes: Buffer): Promise<{ ok: boolean; reason?: string }> {
  const { data, info } = await sharp(pngBytes).flatten({ background: '#ffffff' }).raw().toBuffer({ resolveWithObject: true })
  const W = info.width
  const H = info.height
  const ch = info.channels
  let borderDark = 0
  let borderN = 0
  let centreDark = 0
  let centreN = 0
  const isDark = (i: number) => (data[i] + data[i + 1] + data[i + 2]) / 3 < 225
  for (let y = 0; y < H; y += 4) {
    for (let x = 0; x < W; x += 4) {
      const i = (y * W + x) * ch
      const onBorder = x < W * 0.03 || x > W * 0.97 || y < H * 0.03 || y > H * 0.97
      if (onBorder) { borderN++; if (isDark(i)) borderDark++ }
      else if (x > W * 0.25 && x < W * 0.75 && y > H * 0.25 && y < H * 0.75) { centreN++; if (isDark(i)) centreDark++ }
    }
  }
  if (borderN && borderDark / borderN > 0.2) return { ok: false, reason: 'background is not white at the edges' }
  if (centreN && centreDark / centreN < 0.02) return { ok: false, reason: 'nothing visible in the frame' }
  return { ok: true }
}
