// Quality Lab · candidates FROM HER WAYS TO WEAR.
//
// The composer generator invents looks for the bench. This one replays what a
// real member was actually shown around her pieces (lib/styled-ways), so
// Chloe can review, in a TRAINING batch, exactly the outfits MYRA put in
// front of her — and what she decides teaches the stylist as any batch does.
// Nothing is composed here; a look whose pieces are gone is skipped, and a
// look already cased for this scope is never served twice.

import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import { slotForItemType, slotPlanForAnchor, type Slot } from '@/lib/composer'
import type { ItemWithBrand } from '@/lib/admin-queries'
import { generatedItemFromRow } from '@/lib/outfit-quality/generation-adapters'
import { itemsSignature } from '@/lib/outfit-quality/scope-signature'
import type { CompositionGenerator, GeneratedCandidate } from '@/lib/outfit-quality/candidate-generation'

type Admin = ReturnType<typeof createAdminClient>

const SLOT_ORDER: Slot[] = ['outerwear', 'dress', 'top', 'bottom', 'shoe', 'bag', 'jewellery', 'accessory']

export function createStyledWaysGenerator(admin: Admin = createAdminClient()): CompositionGenerator {
  return {
    async generate({ count, context, exclusions }): Promise<GeneratedCandidate[]> {
      const memberId = context.realMemberId
      if (!memberId) return []
      const db = admin as any
      const { data: rows } = await db.from('styled_way')
        .select('styled_way_id, hero_item_id, item_ids, judged_at')
        .eq('member_id', memberId).eq('stale', false)
        .order('judged_at', { ascending: false }).limit(300)
      const ways = (rows ?? []) as { styled_way_id: string; hero_item_id: string; item_ids: string[] }[]
      if (!ways.length) return []

      const ids = Array.from(new Set(ways.flatMap((w) => w.item_ids)))
      const { data: itemRows } = await db.from('item').select('*, brand(*)').in('item_id', ids)
      const items = new Map<string, ItemWithBrand>(((itemRows ?? []) as ItemWithBrand[]).map((i) => [i.item_id, i]))

      const used = new Set<string>(exclusions?.signatures ?? [])
      const out: GeneratedCandidate[] = []
      for (const w of ways) {
        if (out.length >= count) break
        const signature = itemsSignature(w.item_ids)
        if (used.has(signature)) continue
        const hero = items.get(w.hero_item_id)
        const pieces = w.item_ids.map((id) => items.get(id))
        if (!hero || pieces.some((p) => !p || !p.image_url || !p.item_type || !p.brand?.name)) continue
        used.add(signature)
        const placed = (pieces as ItemWithBrand[]).map((item) => ({ item, slot: slotForItemType(item.item_type) }))
        placed.sort((a, b) => {
          const d = SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot)
          return d !== 0 ? d : a.item.item_id.localeCompare(b.item.item_id)
        })
        const anchorSlot = slotForItemType(hero.item_type)
        const plan = slotPlanForAnchor(anchorSlot)
        out.push({
          requiredSlots: Array.from(new Set([anchorSlot, ...plan.required])),
          items: placed.map(({ item, slot }, idx) => generatedItemFromRow(item, slot, idx)),
          anchorItemId: hero.item_id,
          itemsSignature: signature,
        })
      }
      return out
    },
  }
}
