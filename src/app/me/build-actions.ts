'use server'

// PUTTING ONE TOGETHER HERSELF.
//
// Until now everything ran one way: MYRA composes, the stylist checks, she says
// yes or no. This is the other direction — her own pieces and the ones she has
// saved, on a rail, to try against each other.
//
// TWO SHELVES, ONE POOL. Her wardrobe is `item` rows with ownership='owned'
// (migration 0046 put owned pieces on the same table as retail ones precisely
// so the composer and the house rules treat a linen shirt she owns exactly like
// one for sale). The saved shelf is `saved_item`, which is keyed by her LOGIN,
// not her member id — so both id shapes are needed and they are not the same.
//
// The read that comes back with the shelves is computed in the browser, from
// @/lib/outfit-read, which is pure. Nothing here scores an outfit: she is
// moving pieces around and the note has to keep up with her.
//
// Every action resolves the member on the server — her session, or the member
// Chloe names from HER VIEW, which resolveClientMember honours for the admin
// only. A browser-supplied member id from anyone else resolves to nobody.

import { revalidatePath } from 'next/cache'
import { resolveClientMember } from '@/lib/client-member'
import { createAdminClient } from '@/lib/supabase-server'
import { listOwnedItems } from '@/lib/wardrobe/store'
import { ownerRefsForMember } from '@/lib/wardrobe/owned-items'
import { toHouseItem } from '@/lib/house-item'
import { readStylePrefs, type StylePrefs } from '@/lib/pilot-stylist'
import type { HouseItem } from '@/lib/house-style'
import type { OutfitRead } from '@/lib/outfit-read'

/** A piece on her rail: everything the rules need, plus the picture. */
export type BuildPiece = HouseItem & {
  image_url: string | null
  source: 'wardrobe' | 'saved'
}

export interface SavedBuild {
  outfitId: string
  name: string | null
  occasion: string | null
  pieces: BuildPiece[]
  verdict: OutfitRead | null
  createdAt: string
}

export interface BuildShelves {
  /** Pieces she owns. */
  wardrobe: BuildPiece[]
  /** Pieces she saved from looks MYRA sent her. */
  saved: BuildPiece[]
  /** Her authored preferences, so the note can say why something suits her. */
  prefs: StylePrefs | null
  /** What she has already built, newest first. */
  builds: SavedBuild[]
  /** False until 0065_client_outfit.sql has been run. */
  available: boolean
  test: boolean
}

const MAX_PIECES = 12

export async function loadMyBuildShelves(asMemberId?: string): Promise<BuildShelves | null> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return null

  const admin = createAdminClient() as any
  const blank: BuildShelves = {
    wardrobe: [], saved: [], prefs: null, builds: [], available: false, test: me.test,
  }

  try {
    const [owned, { data: memberRow }, { data: savedRows }] = await Promise.all([
      listOwnedItems(ownerRefsForMember({ member_id: me.memberId, auth_user_id: me.authUserId })),
      admin.from('pilot_member').select('*').eq('member_id', me.memberId).maybeSingle(),
      // saved_item is keyed by her LOGIN, not her member id. A member with no
      // login yet simply has an empty saved shelf, which is the truth.
      me.authUserId
        ? admin.from('saved_item').select('item_id').eq('user_id', me.authUserId).limit(400)
        : Promise.resolve({ data: [] }),
    ])

    const wardrobe: BuildPiece[] = owned
      .filter((it: any) => it.item_type)
      .map((it: any) => ({ ...toHouseItem(it), image_url: it.image_url ?? null, source: 'wardrobe' as const }))

    const savedIds = ((savedRows ?? []) as any[]).map((r) => r.item_id).filter(Boolean)
    let saved: BuildPiece[] = []
    if (savedIds.length) {
      const rows: any[] = []
      for (let i = 0; i < savedIds.length; i += 200) {
        const { data } = await admin
          .from('item').select('*, brand(*)')
          .in('item_id', savedIds.slice(i, i + 200))
          .neq('status', 'archived')
        rows.push(...(data ?? []))
      }
      saved = rows
        .filter((it) => it.item_type)
        .map((it) => ({ ...toHouseItem(it), image_url: it.image_url ?? null, source: 'saved' as const }))
    }

    const prefs = memberRow ? readStylePrefs(memberRow as any) : null

    // The builds table arrives in its own migration; until it is run she can
    // still put pieces together and see the note, she just cannot keep one.
    let builds: SavedBuild[] = []
    let available = false
    const { data: buildRows, error } = await admin
      .from('client_outfit')
      .select('outfit_id, name, occasion, pieces, verdict, created_at')
      .eq('member_id', me.memberId)
      .order('created_at', { ascending: false })
      .limit(60)
    if (!error) {
      available = true
      builds = ((buildRows ?? []) as any[]).map((r) => ({
        outfitId: r.outfit_id,
        name: r.name ?? null,
        occasion: r.occasion ?? null,
        pieces: Array.isArray(r.pieces) ? r.pieces : [],
        verdict: r.verdict ?? null,
        createdAt: r.created_at,
      }))
    }

    return { wardrobe, saved, prefs, builds, available, test: me.test }
  } catch (err) {
    console.error('[loadMyBuildShelves]', err)
    return blank
  }
}

export async function saveMyOutfit(
  input: { pieces: BuildPiece[]; name?: string | null; occasion?: string | null; verdict?: OutfitRead | null },
  asMemberId?: string,
): Promise<{ outfitId?: string; error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { error: 'Not signed in' }

  const pieces = Array.isArray(input.pieces) ? input.pieces.slice(0, MAX_PIECES) : []
  if (pieces.length < 2) return { error: 'An outfit needs at least two pieces' }

  try {
    const admin = createAdminClient() as any
    // Stored in full rather than as ids: a retail piece can be delisted and an
    // owned one deleted, and the outfit she made should outlive either.
    const stored = pieces.map((p) => ({
      item_id: p.item_id,
      source: p.source === 'wardrobe' ? 'wardrobe' : 'saved',
      product_name: p.product_name ?? null,
      brand_name: p.brand_name ?? null,
      item_type: p.item_type ?? null,
      slot: p.slot ?? null,
      colour_family: p.colour_family ?? null,
      image_url: p.image_url ?? null,
    }))

    const { data, error } = await admin
      .from('client_outfit')
      .insert({
        member_id: me.memberId,
        name: input.name?.trim().slice(0, 80) || null,
        occasion: input.occasion || null,
        pieces: stored,
        verdict: input.verdict ?? null,
      })
      .select('outfit_id')
      .single()

    if (error) {
      return { error: /client_outfit/.test(error.message) || error.code === '42P01'
        ? 'Saving outfits is not switched on yet — your stylist has been told'
        : error.message }
    }
    revalidatePath('/me/dressing-room')
    return { outfitId: data.outfit_id }
  } catch (err) {
    console.error('[saveMyOutfit]', err)
    return { error: 'Could not save that outfit — try again' }
  }
}

export async function deleteMyOutfit(outfitId: string, asMemberId?: string): Promise<{ error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { error: 'Not signed in' }
  if (!outfitId) return { error: 'No outfit' }
  try {
    const admin = createAdminClient() as any
    // Scoped by member as well as id: the id alone would let anyone who
    // guessed one delete somebody else's outfit.
    const { error } = await admin
      .from('client_outfit')
      .delete()
      .eq('outfit_id', outfitId)
      .eq('member_id', me.memberId)
    if (error) return { error: error.message }
    revalidatePath('/me/dressing-room')
    return {}
  } catch (err) {
    console.error('[deleteMyOutfit]', err)
    return { error: 'Could not remove that outfit — try again' }
  }
}
