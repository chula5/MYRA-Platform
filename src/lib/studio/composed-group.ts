// Composed item-group image — how an UNAPPROVED outfit is displayed in the
// review queue (unapproved outfits never have a Higgsfield render; the render
// only ever fires on approval). Items are laid out on one clean canvas in a
// FIXED arrangement so every card reads the same way:
//
//   outerwear/top → upper area · bottom or dress → centre · shoes → bottom
//   bag + jewellery/accessory → right-hand side
//
// Built as a single Cloudinary layered-transformation URL: deterministic, so
// Cloudinary derives it once and serves it from CDN cache forever after — and
// we additionally persist the URL on outfit.composed_group_url so the queue
// never rebuilds layout math per load. Each tile is white-padded (c_lpad on a
// light canvas) so retailer shots read as one outfit, not a collage of product
// pages; set CLOUDINARY_BG_REMOVAL=1 to run Cloudinary's background-removal
// add-on per tile (the white-background-cutout treatment) once the add-on is
// enabled on the account.

import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import { persistImageToCloudinary, isCloudinaryUrl } from '@/lib/cloudinary-persist'
import { slotForItemType, type Slot } from '@/lib/composer'
import type { ItemWithBrand } from '@/lib/admin-queries'

const CLOUD_NAME = 'dugby2pow'
const CANVAS_W = 1000
const CANVAS_H = 1333
const CANVAS_BG = 'f7f7f5'

// Fixed per-slot placement — identical on every card.
const LAYOUT: Record<Slot, { g: string; x: number; y: number; w: number; h: number }> = {
  outerwear: { g: 'north_west', x: 30, y: 60, w: 400, h: 520 },
  top:       { g: 'north',      x: -60, y: 40, w: 380, h: 480 },
  dress:     { g: 'center',     x: -110, y: -60, w: 460, h: 640 },
  bottom:    { g: 'center',     x: -110, y: 0, w: 420, h: 560 },
  shoe:      { g: 'south',      x: -140, y: 40, w: 300, h: 260 },
  bag:       { g: 'east',       x: 40, y: 140, w: 300, h: 300 },
  jewellery: { g: 'north_east', x: 50, y: 110, w: 220, h: 220 },
  accessory: { g: 'east',       x: 50, y: -330, w: 240, h: 240 },
}

// Draw order (later layers sit on top).
const DRAW_ORDER: Slot[] = ['outerwear', 'bottom', 'dress', 'top', 'shoe', 'bag', 'accessory', 'jewellery']

/** Cloudinary public id (folder/name, no version, no extension) from a URL. */
export function cloudinaryPublicId(url: string): string | null {
  try {
    if (!isCloudinaryUrl(url)) return null
    const after = url.split('/upload/')[1]
    if (!after) return null
    const parts = after.split('/').filter(
      (p) => !/^v\d+$/.test(p) && !p.includes(','), // drop version + transformation segments
    )
    if (parts.length === 0) return null
    const last = parts[parts.length - 1].replace(/\.[a-z0-9]+$/i, '')
    return [...parts.slice(0, -1), last].join('/')
  } catch {
    return null
  }
}

/** Make sure an item's photo lives on Cloudinary; returns its public id. */
async function ensureItemPublicId(item: ItemWithBrand): Promise<string | null> {
  const url = item.image_url
  if (!url) return null
  const existing = cloudinaryPublicId(url)
  if (existing) return existing

  const hosted = await persistImageToCloudinary(url, {
    folder: 'items',
    publicId: `item-${item.item_id}`,
  })
  if (!hosted) return null
  try {
    const admin = createAdminClient()
    await (admin.from('item') as any).update({ image_url: hosted }).eq('item_id', item.item_id)
  } catch { /* URL still usable this pass */ }
  return cloudinaryPublicId(hosted)
}

export interface ComposedGroupInput {
  item: ItemWithBrand
  slot?: Slot
  /** Grey the tile out (dead item on a restock card). */
  dimmed?: boolean
}

/**
 * Build the composed-group URL for a set of items. Returns null only when no
 * item image could be hosted. One item per slot — first in wins; a second
 * bag/jewellery piece falls back to the accessory position if free.
 */
export async function buildComposedGroupUrl(inputs: ComposedGroupInput[]): Promise<string | null> {
  const bgRemoval = process.env.CLOUDINARY_BG_REMOVAL === '1'
  const placed = new Map<Slot, { publicId: string; dimmed: boolean }>()

  for (const input of inputs) {
    let slot = input.slot ?? slotForItemType(input.item.item_type)
    if (placed.has(slot)) {
      if (!placed.has('accessory')) slot = 'accessory'
      else continue
    }
    const publicId = await ensureItemPublicId(input.item)
    if (!publicId) continue
    placed.set(slot, { publicId, dimmed: !!input.dimmed })
  }
  if (placed.size === 0) return null

  const layerRef = (publicId: string) => publicId.replace(/\//g, ':')

  const components: string[] = []
  // Base canvas: pad the first tile to full canvas, then colorize it flat —
  // a clean solid ground the layers sit on.
  const first = Array.from(placed.values())[0]
  components.push(`w_${CANVAS_W},h_${CANVAS_H},c_pad,b_rgb:${CANVAS_BG}`)
  components.push(`e_colorize:100,co_rgb:${CANVAS_BG}`)

  for (const slot of DRAW_ORDER) {
    const layer = placed.get(slot)
    if (!layer) continue
    const pos = LAYOUT[slot]
    components.push(`l_${layerRef(layer.publicId)}`)
    if (bgRemoval) components.push('e_background_removal')
    components.push(`c_lpad,w_${pos.w},h_${pos.h},b_rgb:${CANVAS_BG}`)
    if (layer.dimmed) components.push('e_grayscale/o_35')
    components.push(`fl_layer_apply,g_${pos.g},x_${pos.x},y_${pos.y}`)
  }
  components.push('f_auto,q_auto')

  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/${components.join('/')}/${first.publicId}`
}

/**
 * Build (or rebuild) and cache an outfit's composed group image. `dimItemId`
 * greys one item out (restock cards). Stores the URL on the outfit row.
 */
export async function refreshComposedGroup(
  outfitId: string,
  items: ComposedGroupInput[],
  opts: { persist?: boolean } = {},
): Promise<string | null> {
  const url = await buildComposedGroupUrl(items)
  if (url && opts.persist !== false) {
    try {
      const admin = createAdminClient()
      await (admin.from('outfit') as any).update({ composed_group_url: url }).eq('outfit_id', outfitId)
    } catch { /* card can still use the returned URL */ }
  }
  return url
}
