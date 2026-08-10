'use server'

// Brand logos, set by hand. The automated passes get most houses, but the big
// ones (Isabel Marant, Posse, Cult Gaia…) sit behind bot shields that refuse
// any server-side fetch, so those have to be uploaded here.

import { createAdminClient } from '@/lib/supabase-server'
import { revalidatePath } from 'next/cache'

const BUCKET = 'brand-logos'
const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
}

const slug = (n: string) =>
  n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, 'and').trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

export type BrandLogoRow = {
  brand_id: string
  name: string
  logo_url: string | null
  item_count: number
}

export async function listBrandLogos(): Promise<BrandLogoRow[]> {
  const supa = createAdminClient()
  const { data: brands } = await supa.from('brand').select('brand_id, name, logo_url').order('name')
  if (!brands) return []

  // One query for the counts rather than one per brand.
  const { data: items } = await supa.from('item').select('brand_id')
  const counts = new Map<string, number>()
  for (const i of items ?? []) {
    if (i.brand_id) counts.set(i.brand_id, (counts.get(i.brand_id) ?? 0) + 1)
  }

  return brands.map((b) => ({
    brand_id: b.brand_id,
    name: b.name,
    logo_url: b.logo_url,
    item_count: counts.get(b.brand_id) ?? 0,
  }))
}

/** Store bytes in the public bucket and point the brand (and its name-variants) at it. */
async function store(brandId: string, name: string, bytes: Buffer, contentType: string) {
  const supa = createAdminClient()
  const path = `${slug(name)}.${EXT[contentType] ?? 'png'}`
  const { error } = await supa.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true })
  if (error) return { error: error.message }

  // Cache-bust: the path is stable per brand, so a replacement would otherwise
  // keep serving the old file from the CDN.
  const url = `${supa.storage.from(BUCKET).getPublicUrl(path).data.publicUrl}?v=${bytes.length}`

  const { error: updErr } = await supa.from('brand').update({ logo_url: url }).eq('brand_id', brandId)
  if (updErr) return { error: updErr.message }

  // Apply to every row that is the same house under different casing, so the
  // duplicates in the table don't fall back to plain text.
  const key = slug(name)
  const { data: siblings } = await supa.from('brand').select('brand_id, name')
  for (const s of siblings ?? []) {
    if (s.brand_id !== brandId && slug(s.name) === key) {
      await supa.from('brand').update({ logo_url: url }).eq('brand_id', s.brand_id)
    }
  }

  revalidatePath('/admin/brand-logos')
  revalidatePath('/')
  return { url }
}

/** Upload a file chosen in the browser. */
export async function uploadBrandLogo(formData: FormData) {
  const brandId = String(formData.get('brand_id') ?? '')
  const name = String(formData.get('name') ?? '')
  const file = formData.get('file')
  if (!brandId || !name) return { error: 'Missing brand' }
  if (!(file instanceof File) || file.size === 0) return { error: 'Choose a file first' }
  if (file.size > 4_000_000) return { error: 'That file is over 4MB — please use a smaller one' }
  if (!file.type.startsWith('image/')) return { error: 'That is not an image' }

  const bytes = Buffer.from(await file.arrayBuffer())
  return store(brandId, name, bytes, file.type)
}

/** Pull a logo from a URL that has been pasted in. */
export async function fetchBrandLogoFromUrl(brandId: string, name: string, url: string) {
  if (!brandId || !name) return { error: 'Missing brand' }
  let target: URL
  try {
    target = new URL(url.trim())
  } catch {
    return { error: 'That is not a valid URL' }
  }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    return { error: 'URL must be http or https' }
  }

  try {
    const r = await fetch(target, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    })
    if (!r.ok) return { error: `That URL returned ${r.status}` }
    const ct = (r.headers.get('content-type') ?? '').split(';')[0].trim()
    if (!ct.startsWith('image/')) return { error: `That URL is ${ct || 'not an image'} — link straight to the image file` }
    const bytes = Buffer.from(await r.arrayBuffer())
    if (bytes.length < 200) return { error: 'That image is empty' }
    return store(brandId, name, bytes, ct)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not fetch that URL' }
  }
}

/** Clear a logo that looks wrong, so the tile falls back to the brand name. */
export async function clearBrandLogo(brandId: string) {
  const supa = createAdminClient()
  const { error } = await supa.from('brand').update({ logo_url: null }).eq('brand_id', brandId)
  if (error) return { error: error.message }
  revalidatePath('/admin/brand-logos')
  revalidatePath('/')
  return { ok: true }
}
