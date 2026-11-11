// A SCREENSHOT INTO OUTFIT REVIEW — the piece MYRA builds a project around.
//
// Chloe screenshots a piece (a shop page, an Instagram post, a newsletter) and
// drops it on Outfit Review. The picture is hosted and read by the eye
// (lib/screenshot-save: brand, name, price, cut, colour); MYRA then hunts for
// the real product — her own library by name, the brand's rail, the web — and
// either finds the piece she already holds, adds the real product to the
// library as a draft, or keeps the screenshot itself as a draft piece. Either
// way the piece is scored from its picture so the composer can read its
// shape, and it becomes the anchor of a project.

import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import { uploadImageBytesToCloudinary } from '@/lib/cloudinary-persist'
import { cloudinaryConfigured } from '@/lib/cloudinary-config'
import { readWordFromImage } from '@/lib/openai-vision'
import { READ_PROMPT, parseScreenshotRead, readLine, pieceName, findProductForRead, type ScreenshotRead } from '@/lib/screenshot-save'
import { classifyExternalProduct } from '@/lib/brand-watch'
import { insertItemTolerantly } from '@/lib/wardrobe/store'
import { loadBrandGraph, resolveBrandNames } from '@/lib/brand-affinity'
import { ensureItemsScored } from '@/lib/pipeline-store'
import { getItem } from '@/lib/admin-queries'
import { priceOfItem } from '@/lib/brand-affinity'
import type { ProjectAnchor } from '@/lib/review-projects'

export interface ScreenshotIntake {
  anchor?: ProjectAnchor
  /** What the eye made of the picture, in a line. */
  read?: string | null
  /** How the piece was placed: already in MYRA, found on a shop, or the screenshot itself. */
  how?: 'library' | 'found' | 'screenshot'
  message?: string
  error?: string
}

function priceLabel(it: any): string {
  const { gbp } = priceOfItem(it)
  if (gbp != null) return `£${Math.round(gbp)}`
  return it.price ? String(it.price) : ''
}

function anchorOf(it: any): ProjectAnchor {
  return {
    item_id: it.item_id, product_name: it.product_name, brand_name: it.brand?.name ?? null, image_url: it.image_url,
    item_type: String(it.item_type), price: priceLabel(it), colour_family: it.colour_family ?? null,
    stock_status: it.stock_status ?? null, stock_sizes: it.stock_sizes ?? null,
  }
}

const baseUrl = (u: string) => u.split(/[?#]/)[0]

export async function intakeScreenshot(bytes: Buffer, contentType: string): Promise<ScreenshotIntake> {
  if (!cloudinaryConfigured()) return { error: 'Saving screenshots is not set up on the server yet' }
  if (!process.env.OPENAI_API_KEY) return { error: 'MYRA cannot read pictures on the server yet (no OPENAI_API_KEY)' }
  const admin = createAdminClient() as any

  const hosted = await uploadImageBytesToCloudinary(bytes, contentType || 'image/png', { folder: 'review-screenshots', publicId: `review-${Date.now()}` })
  if (!hosted) return { error: 'Could not keep that picture — try again' }

  const r = await readWordFromImage(hosted, READ_PROMPT, { maxTokens: 220, detail: 'high' })
  if (r.error) console.error('[review-screenshot] read', r.error)
  const read: ScreenshotRead | null = r.word ? parseScreenshotRead(r.word) : null
  if (!read) return { error: 'MYRA could not read that screenshot — try one that shows the piece clearly' }
  if (!read.fashion || (!read.type && !read.words.length && !read.name)) return { error: 'MYRA cannot see a piece of clothing, a shoe or a bag in that screenshot' }
  const line = readLine(read)

  // The real product, when it can be found.
  let itemId: string | null = null
  let how: ScreenshotIntake['how'] = 'screenshot'
  let via = ''
  const found = await findProductForRead(admin, read, hosted).catch((err) => { console.error('[review-screenshot] hunt', err); return null })
  if (found) {
    const base = baseUrl(found.product.url)
    const { data: existing } = await admin.from('item').select('item_id').like('retailer_url', `${base}%`).neq('status', 'archived').limit(1)
    if (existing?.[0]?.item_id) { itemId = existing[0].item_id; how = 'library'; via = found.via }
    else if (found.product.image) {
      const scanned = classifyExternalProduct({
        url: found.product.url, title: found.product.title, description: '', category: found.product.type ?? read.type ?? '',
        brand: found.product.brand ?? read.brand ?? null, price: found.product.price ?? read.price_gbp, currency: 'GBP', images: [found.product.image], available: true,
      })
      const itemType = read.type ?? scanned.itemType ?? null
      if (itemType && !scanned.nonFashion) {
        const host = (() => { try { return new URL(found.product.url).host } catch { return '' } })()
        const ins = await insertItemTolerantly(admin, {
          brand_id: found.brand?.brand_id ?? null,
          item_type: itemType,
          product_name: found.product.title.slice(0, 200),
          retailer_url: base,
          image_url: found.product.image,
          price: found.product.price ?? read.price_gbp, currency: 'GBP', price_gbp: found.product.price ?? read.price_gbp,
          colour_family: read.colour ?? scanned.colourFamily ?? null,
          material_category: scanned.materialCategory ?? null,
          material_primary: scanned.materialPrimary ?? null,
          stock_status: 'in_stock', available: true,
          status: 'draft',
          source: 'retailer_api',
          in_inventory: false,
          discovery_source: 'screenshot',
          admin_notes: `Outfit Review — from a screenshot Chloe dropped in; found on ${host}${found.brand ? '' : found.product.brand ? ` (brand "${found.product.brand}" not in MYRA)` : ''}`,
        })
        if (ins.itemId) { itemId = ins.itemId; how = 'found'; via = found.via }
      }
    }
  }

  // The screenshot is the piece.
  if (!itemId) {
    const graph = await loadBrandGraph(admin)
    const brand = read.brand ? resolveBrandNames(graph, [read.brand]).matched[0] ?? null : null
    const name = pieceName(read, !!brand)
    const scanned = classifyExternalProduct({
      url: `https://screenshot.myra/${encodeURIComponent(read.words.join('-') || 'piece')}`, title: name, description: '', category: read.type ?? '',
      brand: brand?.name ?? read.brand ?? null, price: read.price_gbp, currency: read.price_gbp != null ? 'GBP' : null, images: [hosted], available: true,
    })
    const itemType = read.type ?? scanned.itemType ?? null
    if (!itemType) return { read: line, error: "MYRA can't tell what kind of piece that is yet" }
    const ins = await insertItemTolerantly(admin, {
      brand_id: brand?.brand_id ?? null,
      item_type: itemType,
      product_name: name,
      retailer_url: null,
      image_url: hosted,
      price: read.price_gbp, currency: 'GBP', price_gbp: read.price_gbp,
      colour_family: read.colour ?? scanned.colourFamily ?? null,
      material_category: scanned.materialCategory ?? null,
      material_primary: scanned.materialPrimary ?? null,
      stock_status: 'in_stock', available: true,
      status: 'draft',
      source: 'retailer_api',
      in_inventory: false,
      discovery_source: 'screenshot',
      admin_notes: `Outfit Review — from a screenshot Chloe dropped in${read.brand && !brand ? ` (brand "${read.brand}" not in MYRA)` : ''}`,
    })
    if (!ins.itemId) return { read: line, error: ins.error ?? 'Could not keep a note of this piece' }
    itemId = ins.itemId
  }

  // Scored from its picture, so the composer can read its shape and colour depth.
  let item: any = await getItem(itemId)
  if (!item) return { read: line, error: 'The piece was kept but could not be read back' }
  try {
    await ensureItemsScored([item])
    item = (await getItem(itemId)) ?? item
  } catch (err) { console.error('[review-screenshot] score', err) }

  const anchor = anchorOf(item)
  const what = [anchor.brand_name, anchor.product_name].filter(Boolean).join(' ')
  const message = how === 'library' ? `${what} — MYRA already holds it${via ? ` (${via})` : ''}`
    : how === 'found' ? `${what} — ${via}; added to the library as a draft`
    : `${what} — kept from the screenshot as a draft piece`
  return { anchor, read: line, how, message }
}
