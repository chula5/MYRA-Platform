// Pure mapper: a library item row → the House Style Constitution's item shape.
// Kept free of 'server-only' so the composers (and their tests) can gate
// candidate looks through evaluateHouseStyle without a server import.
import type { HouseItem } from '@/lib/house-style'
import type { ItemWithBrand } from '@/lib/admin-queries'
import { slotForItemType } from '@/lib/composer'

export function toHouseItem(it: ItemWithBrand, slot?: string): HouseItem {
  const a = it as any
  return {
    item_id: it.item_id,
    slot: slot ?? slotForItemType(it.item_type),
    item_type: it.item_type as string,
    product_name: it.product_name,
    brand_name: it.brand?.name ?? a.owned_metadata?.brand_label ?? null,
    colour_family: a.colour_family ?? null,
    colour_hex: a.colour_hex ?? null,
    colour_depth: a.colour_depth ?? null,
    pattern: a.pattern ?? null,
    surface: a.surface ?? null,
    sheen: a.sheen ?? null,
    fit: a.fit ?? null,
    structure: a.structure ?? null,
    waist_definition: a.waist_definition ?? null,
    leg_opening: a.leg_opening ?? null,
    length: a.length ?? null,
    material_category: a.material_category ?? null,
    material_primary: a.material_primary ?? null,
    material_formality: a.material_formality ?? null,
    material_weight: a.material_weight ?? null,
    jewellery_scale: a.jewellery_scale ?? null,
    jewellery_finish: a.jewellery_finish ?? null,
    jewellery_style: a.jewellery_style ?? null,
    // Owned items have no retail price: null here means the price-integrity
    // rule simply skips them rather than failing the outfit.
    price: a.price ?? null,
    price_tier: (it.brand as any)?.price_tier ?? null,
    print_flag: a.print_flag ?? null,
    neckline: a.neckline ?? null,
    is_activewear: a.is_activewear ?? null,
  }
}
