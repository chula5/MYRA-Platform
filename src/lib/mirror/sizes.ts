// MYRA Mirror — a brand site's size data → MYRA's size rows.
//
// Shopify's product JSON lists every variant with `available`; pre-owned
// stores put the one size in the title ("… - size UK 18"). Both become the
// same SizeRow[] the feed's size machinery already understands
// (size-canonical / size-match), so "in your size" means the same thing on a
// brand site as it does in her MYRA feed. Pure — no DB, no framework.

import { parseSizeLabel, type SizeCategory } from '@/lib/size-canonical'
import type { SizeRow } from '@/lib/size-match'

export interface PageSize { label: string; available: boolean }

/** "Brown plaid trousers - size UK 18" → "UK 18"; "heels - size EU 38.5 (UK 5.5)" → "EU 38.5 (UK 5.5)"; "cardigan - size M" → "M". */
export function sizeLabelInTitle(title: string | null | undefined): string | null {
  if (!title) return null
  const m = title.match(/\bsize\s*[:\-]?\s*(?:([A-Za-z]{0,4}\s*\d{1,2}(?:[.,]\d)?(?:\s*\([^)]*\))?)|(XXS|XS|S|M|L|XL|XXL|one size)\b)/i)
  return m ? (m[1] ?? m[2]).trim() : null
}

function row(label: string, available: boolean, category: SizeCategory): SizeRow {
  const parsed = parseSizeLabel(label, category)
  const values = parsed?.values ?? []
  return {
    size_label: label,
    size_system: parsed?.system ?? null,
    canonical_category: category,
    canonical_value: values[0] ?? null,
    canonical_values: values,
    in_stock: available,
    stock_level: available ? 'in_stock' : 'sold_out',
  }
}

/**
 * Size rows for one page product. Variants win; a size in the title is the
 * fallback (one-of-one stock). No category (bags, jewellery) → no rows, and
 * no rows never demotes a piece.
 */
export function sizeRowsFor(
  sizes: PageSize[] | null | undefined,
  title: string | null | undefined,
  category: SizeCategory | null,
): { rows: SizeRow[]; unique: boolean } {
  if (!category) return { rows: [], unique: false }
  const list = (sizes ?? []).filter((s) => s && typeof s.label === 'string' && s.label.trim())
  if (list.length) {
    // Same label on two colourways: available in any = available.
    const byLabel = new Map<string, boolean>()
    for (const s of list) byLabel.set(s.label.trim(), (byLabel.get(s.label.trim()) ?? false) || !!s.available)
    const rows = [...byLabel].map(([label, available]) => row(label, available, category))
    const titled = sizeLabelInTitle(title)
    // Pre-owned stores also expose the single size as one variant — that is still one-of-one.
    return { rows, unique: !!titled && byLabel.size === 1 }
  }
  const titled = sizeLabelInTitle(title)
  if (!titled) return { rows: [], unique: false }
  return { rows: [row(titled, true, category)], unique: true }
}
