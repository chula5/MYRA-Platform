// Stage 3/4 glue, pure: which scored dimensions deserve a lower-confidence
// flag, and how an approved extraction becomes an `item` row.

import type { AnalysedProduct } from '@/app/admin/items/analyse-url'
import type { DetectedGarment, ExtractionEdits, OwnerRef, OwnedMetadata } from './types'
import { productNameFromDetected } from './detect'

export const SCORED_DIMS: (keyof AnalysedProduct)[] = [
  'fit', 'length', 'rise', 'structure', 'shoulder', 'neckline', 'sleeve', 'waist_definition',
  'leg_opening', 'surface', 'colour_depth', 'pattern', 'sheen', 'material_weight',
  'material_formality', 'jewellery_scale', 'jewellery_formality',
]

// The brand-derived signals an owned item simply lacks when brand is null.
// These are not item columns — they are the brand dims of the item vector
// (price_tier / aesthetic_output / era_orientation) — but the composer's
// material_formality and pairCompat's brand-tier proximity lean on them too,
// so we log them as scored-with-less-evidence.
export const BRAND_DERIVED_DIMS = ['brand_price_tier', 'brand_aesthetic_output', 'brand_era_orientation', 'material_formality'] as const

/**
 * Dimensions scored with lower confidence, and why. Logged on the extraction
 * (and into owned_metadata) so the review card can show them and the taste
 * maths can, later, down-weight them.
 */
export function lowConfidenceDims(
  scores: AnalysedProduct | null,
  ctx: { brandKnown: boolean; detected?: Pick<DetectedGarment, 'material_guess' | 'confidence'> | null },
): string[] {
  const out = new Set<string>()
  if (!ctx.brandKnown) for (const d of BRAND_DERIVED_DIMS) out.add(d)
  const materialUnknown = !scores?.material_category && !scores?.material_primary && !ctx.detected?.material_guess
  if (materialUnknown) for (const d of ['material_weight', 'material_formality', 'sheen']) out.add(d)
  if ((ctx.detected?.confidence ?? 1) < 0.6) for (const d of ['fit', 'structure', 'length']) out.add(d)
  return Array.from(out)
}

const INT_1_5 = (v: unknown): number | null => {
  const n = typeof v === 'string' ? parseInt(v, 10) : typeof v === 'number' ? v : NaN
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null
}

export interface BuildOwnedItemInput {
  detected: DetectedGarment
  scores: AnalysedProduct | null
  edits: ExtractionEdits
  owner: OwnerRef
  photoId: string
  extractionId: string
  cutoutUrl: string
  brandId: string | null
  lowConfidence: string[]
}

/** The `item` insert for an approved owned garment. Edits win over scores win over detection. */
export function buildOwnedItemRow(i: BuildOwnedItemInput): Record<string, unknown> {
  const s = i.scores
  const e = i.edits
  const es = e.scores ?? {}
  const pick = (k: keyof AnalysedProduct) => INT_1_5(es[k] ?? s?.[k] ?? null)
  const itemType = e.item_type ?? s?.item_type ?? i.detected.item_type
  const metadata: OwnedMetadata = {
    owned_since: e.owned_since ?? null,
    fit_notes: e.fit_notes ?? null,
    favourite: e.favourite ?? null,
    brand_label: i.brandId ? null : (e.brand_name ?? i.detected.brand_hint ?? null),
    notes: e.notes ?? null,
    low_confidence_dims: i.lowConfidence,
  }
  const estimated = e.estimated_value != null && Number.isFinite(Number(e.estimated_value)) && Number(e.estimated_value) > 0
    ? Number(e.estimated_value)
    : null
  return {
    brand_id: i.brandId,
    item_type: itemType,
    product_name: (e.product_name && e.product_name.trim()) || productNameFromDetected(i.detected),
    retailer_url: null,
    image_url: i.cutoutUrl,
    price: null,
    currency: null,
    in_inventory: false,
    source: 'manual',
    // Owned items are composable ('ready') but NEVER live — live is the public feed.
    status: 'ready',
    admin_notes: `Wardrobe import · extraction ${i.extractionId}`,
    notes: i.detected.description || null,
    colour_hex: e.colour_hex ?? s?.colour_hex ?? i.detected.colour_hex,
    colour_family: e.colour_family ?? s?.colour_family ?? i.detected.colour_family,
    material_primary: e.material_primary ?? s?.material_primary ?? i.detected.material_guess,
    material_category: e.material_category ?? s?.material_category ?? null,
    fit: pick('fit'),
    length: pick('length'),
    rise: pick('rise'),
    structure: pick('structure'),
    shoulder: pick('shoulder'),
    neckline: pick('neckline'),
    sleeve: pick('sleeve'),
    waist_definition: pick('waist_definition'),
    leg_opening: pick('leg_opening'),
    surface: pick('surface'),
    colour_depth: pick('colour_depth'),
    pattern: pick('pattern'),
    sheen: pick('sheen'),
    material_weight: pick('material_weight'),
    material_formality: pick('material_formality'),
    jewellery_scale: pick('jewellery_scale'),
    jewellery_formality: pick('jewellery_formality'),
    // She owns it — it is, by definition, in stock.
    stock_status: 'in_stock',
    stock_checked_at: new Date().toISOString(),
    ownership: 'owned',
    owner_user_id: i.owner.id,
    owner_kind: i.owner.kind,
    source_photo_id: i.photoId,
    extraction_id: i.extractionId,
    extraction_confidence: i.detected.confidence,
    estimated_value: estimated,
    owned_metadata: metadata,
  }
}
