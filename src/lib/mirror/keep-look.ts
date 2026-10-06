// MYRA Mirror — keep a whole look, not just a piece.
//
// "Save this look to MYRA" on the panel beside a brand site. The look lands
// in two places she already has, so the extension and the app stop being
// separate: every piece she does not own goes to her saved pieces (the same
// list the heart on a tile feeds, with MYRA watching its stock), and the look
// itself becomes one of her own outfits in the Dressing Room — hers the
// moment she keeps it, nobody reviews it, exactly like one she built herself.

import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'
import { slotForItemType } from '@/lib/composer'
import { saveForMember } from './save'
import type { SiteProduct } from './style'
import type { MirrorMember } from './auth'

export interface KeptLookItem {
  item_id?: string | null
  product_name?: string | null
  brand?: string | null
  image_url?: string | null
  url?: string | null
  owned?: boolean
}

export interface KeepLookResult { outfit_id?: string; saved?: number; error?: string }

const MAX_PIECES = 12

export async function keepLookForMember(member: MirrorMember, product: SiteProduct, look: KeptLookItem[]): Promise<KeepLookResult> {
  const admin = createAdminClient() as any

  // The piece she was looking at: saved in full, so its stock is watched too.
  const hero = await saveForMember(member, product)
  if (hero.error || !hero.item_id) return { error: hero.error ?? 'Could not keep this piece' }

  // The rest of the look: MYRA's own pieces carry an item id already, so they
  // go straight to her saved list; her own pieces are hers and need nothing.
  const ids = Array.from(new Set(look.map((it) => it.item_id).filter((id): id is string => typeof id === 'string' && id.length > 0)))
  const { data: rows } = ids.length
    ? await admin.from('item').select('item_id, product_name, image_url, item_type, colour_family, retailer_url, brand:brand_id(name)').in('item_id', ids)
    : { data: [] }
  const byId = new Map<string, any>((rows ?? []).map((r: any) => [r.item_id, r]))

  let saved = 1
  const toSave = look.filter((it) => !it.owned && it.item_id && byId.has(it.item_id) && it.item_id !== hero.item_id)
  for (const it of toSave) {
    const id = it.item_id as string
    const row = byId.get(id)
    const host = (() => { try { return new URL(row?.retailer_url ?? it.url ?? '').host.replace(/^www\./, '') } catch { return null } })()
    const { error } = await admin.from('member_saved_item')
      .upsert({ member_id: member.member_id, item_id: id, source_host: host }, { onConflict: 'member_id,item_id' })
    if (!error) {
      saved++
      if (member.auth_user_id) {
        try { await admin.from('saved_item').upsert({ user_id: member.auth_user_id, item_id: id }, { onConflict: 'user_id,item_id' }) } catch { /* optional mirror */ }
      }
    }
  }

  // The look as one of her own outfits. Stored in full, as the builder does:
  // a retail piece can be delisted and the outfit she kept should outlive it.
  const { data: heroRow } = await admin.from('item').select('item_id, product_name, image_url, item_type, colour_family, brand:brand_id(name)').eq('item_id', hero.item_id).maybeSingle()
  const piece = (r: any, fallback: KeptLookItem, source: 'wardrobe' | 'saved') => ({
    item_id: r?.item_id ?? fallback.item_id ?? null,
    source,
    product_name: r?.product_name ?? fallback.product_name ?? null,
    brand_name: r?.brand?.name ?? fallback.brand ?? null,
    item_type: r?.item_type ?? null,
    slot: r?.item_type ? slotForItemType(r.item_type as any) : null,
    colour_family: r?.colour_family ?? null,
    image_url: r?.image_url ?? fallback.image_url ?? null,
  })
  const pieces = [
    piece(heroRow, { item_id: hero.item_id, product_name: product.title, brand: product.brand ?? null, image_url: product.image ?? null }, 'saved'),
    ...look
      .filter((it) => it.item_id !== hero.item_id)
      .map((it) => piece(it.item_id ? byId.get(it.item_id) : null, it, it.owned ? 'wardrobe' : 'saved')),
  ].slice(0, MAX_PIECES)
  if (pieces.length < 2) return { saved, error: 'That look has only one piece — kept the piece itself' }

  const name = `Around the ${product.title}`.slice(0, 80)
  const { data, error } = await admin.from('client_outfit')
    .insert({ member_id: member.member_id, name, occasion: null, pieces, verdict: null })
    .select('outfit_id').single()
  if (error) {
    // Pre-0065 the outfits table is not there: the pieces are still hers.
    return { saved, error: /client_outfit|42P01/.test(`${error.message} ${error.code ?? ''}`) ? 'Pieces kept — outfits need migration 0065 first' : error.message }
  }
  return { outfit_id: data.outfit_id, saved }
}
