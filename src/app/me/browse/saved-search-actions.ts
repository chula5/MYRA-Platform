'use server'

// SAVED SEARCHES — her side: keep a search, see what MYRA found since, let one go.
// The finding itself is lib/saved-search (the hourly cron); these only read and
// mark what is hers. Every one resolves her from the session first.

import { createAdminClient } from '@/lib/supabase-server'
import { resolveClientMember } from '@/lib/client-member'
import { searchForMember, type BrowseFilters } from '@/lib/member-search'
import { savedSearchesFor, MAX_SEARCHES, type SavedSearchView } from '@/lib/saved-search'

export type { SavedSearchView } from '@/lib/saved-search'

/** Keep this search. What it answers now is seeded as seen, so NEW means what comes after. */
export async function saveSearch(query: string, filters: BrowseFilters = {}, asMemberId?: string): Promise<{ id?: string; error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { error: 'Not signed in' }
  const q = query.trim().slice(0, 120)
  if (q.length < 2) return { error: 'Type a search first' }
  const admin = createAdminClient() as any

  const { count } = await admin.from('saved_search').select('saved_search_id', { count: 'exact', head: true })
    .eq('member_id', me.memberId).eq('active', true)
  if ((count ?? 0) >= MAX_SEARCHES) return { error: `You can keep ${MAX_SEARCHES} searches — let one go first` }

  const view = await searchForMember(admin, me.memberId, q, filters)
  const now = new Date().toISOString()
  const { data, error } = await admin.from('saved_search').upsert({
    member_id: me.memberId, query: q, filters, label: view.read.join(' · ') || null,
    active: true, last_run_at: now, last_seen_at: now,
  }, { onConflict: 'member_id,query' }).select('saved_search_id').single()
  if (error) return { error: /saved_search/.test(error.message) ? 'Run migration 0110 first' : error.message }

  if (view.pieces.length) {
    await admin.from('saved_search_hit').upsert(
      view.pieces.map((p) => ({ saved_search_id: data.saved_search_id, item_id: p.item_id, found_at: now, seen_at: now })),
      { onConflict: 'saved_search_id,item_id', ignoreDuplicates: true },
    )
  }
  return { id: data.saved_search_id }
}

/** Her saved searches with the count of what is new in each. */
export async function listMySearches(asMemberId?: string): Promise<{ searches: SavedSearchView[]; error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { searches: [], error: 'Not signed in' }
  return { searches: await savedSearchesFor(createAdminClient() as any, me.memberId) }
}

/** Open one search: what MYRA found since she last looked, then marked seen. */
export async function openSavedSearch(id: string, asMemberId?: string): Promise<{ search?: SavedSearchView; fresh: string[]; filters?: BrowseFilters; error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { fresh: [], error: 'Not signed in' }
  const admin = createAdminClient() as any
  const { data: row } = await admin.from('saved_search').select('saved_search_id, filters')
    .eq('saved_search_id', id).eq('member_id', me.memberId).maybeSingle()
  if (!row) return { fresh: [], error: 'That search is no longer kept' }

  const { data: unseen } = await admin.from('saved_search_hit').select('item_id')
    .eq('saved_search_id', id).is('seen_at', null).order('found_at', { ascending: false }).limit(96)
  const fresh = ((unseen ?? []) as any[]).map((h) => h.item_id)
  const search = (await savedSearchesFor(admin, me.memberId, 96)).find((s) => s.id === id)

  // Chloe looking as her from HER VIEW never clears her NEW.
  if (!me.test) {
    const now = new Date().toISOString()
    await admin.from('saved_search_hit').update({ seen_at: now }).eq('saved_search_id', id).is('seen_at', null)
    await admin.from('saved_search').update({ last_seen_at: now }).eq('saved_search_id', id)
  }
  return { search, fresh, filters: row.filters ?? {} }
}

/** Stop looking. */
export async function removeSearch(id: string, asMemberId?: string): Promise<{ error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { error: 'Not signed in' }
  const { error } = await (createAdminClient() as any).from('saved_search').delete()
    .eq('saved_search_id', id).eq('member_id', me.memberId)
  return error ? { error: error.message } : {}
}
