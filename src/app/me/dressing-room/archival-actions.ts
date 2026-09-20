'use server'

// ARCHIVAL LOOKS — the browser-callable surface. Every action resolves the
// member on the server (her session, or the member Chloe names from HER VIEW —
// admin only) and passes only that id on. Like her inbox, connecting Instagram
// from HER VIEW is real: it is her actual account.

import { waitUntil } from '@vercel/functions'
import { resolveClientMember } from '@/lib/client-member'
import { createAdminClient } from '@/lib/supabase-server'
import { emailSecretsConfigured } from '@/lib/email/secrets'
import { instagramConfigured } from '@/lib/archival/instagram'
import {
  MIGRATION_HINT, disconnectInstagram, hideArchivalLook, importArchivalPhoto, listArchivalLooks, listInstagramConnections,
  readArchivalLooks, syncInstagram, uploadSourceId,
  type ArchivalLookView, type InstagramConnectionView,
} from '@/lib/archival/store'
import { approveExtraction, discardExtraction } from '@/lib/wardrobe/store'
import { processWardrobeQueue } from '@/lib/wardrobe/queue'
import type { OwnerRef } from '@/lib/wardrobe/types'

export interface ArchivalPanelView {
  memberId: string | null
  instagramReady: boolean
  connections: InstagramConnectionView[]
  looks: ArchivalLookView[]
  error?: string
}

const ownerOf = (memberId: string): OwnerRef => ({ kind: 'pilot_member', id: memberId })

/** Detection, cut-outs and outfit reads carry on after the response. */
function workInBackground(memberId: string) {
  const job = (async () => { await processWardrobeQueue(45_000).catch(() => undefined); await readArchivalLooks(memberId, 4).catch(() => undefined) })()
  try { waitUntil(job) } catch { /* local dev: the promise simply runs */ }
}

export async function loadArchivalPanel(asMemberId?: string): Promise<ArchivalPanelView> {
  const me = await resolveClientMember(asMemberId)
  const base = { instagramReady: instagramConfigured() && emailSecretsConfigured() }
  if (!me) return { memberId: null, connections: [], looks: [], ...base }
  try {
    const [connections, looks] = await Promise.all([listInstagramConnections(me.memberId), listArchivalLooks(me.memberId)])
    return { memberId: me.memberId, connections, looks, ...base }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { memberId: me.memberId, connections: [], looks: [], ...base, error: /archival_look|member_instagram_connection/.test(msg) ? MIGRATION_HINT : msg }
  }
}

export async function syncArchivalInstagram(asMemberId?: string): Promise<{ added?: number; error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { error: 'Not signed in' }
  const r = await syncInstagram(me.memberId)
  if (r.added) workInBackground(me.memberId)
  return r.error ? { error: r.error, added: r.added } : { added: r.added }
}

/** One photo per call — server actions carry a small body, and each photo is its own piece of work. */
export async function uploadArchivalPhoto(formData: FormData): Promise<{ lookId?: string; skipped?: boolean; error?: string }> {
  const me = await resolveClientMember(String(formData.get('member') ?? '') || undefined)
  if (!me) return { error: 'Not signed in' }
  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) return { error: 'Empty file' }
  if (!file.type.startsWith('image/')) return { error: 'That is not an image' }
  const bytes = Buffer.from(await file.arrayBuffer())
  const r = await importArchivalPhoto(me.memberId, { bytes, name: file.name, mime: file.type, source: 'upload', sourceId: uploadSourceId(bytes), takenAt: file.lastModified ? new Date(file.lastModified).toISOString() : null })
  if (r.lookId && !r.skipped) workInBackground(me.memberId)
  return r
}

/** The section calls this while photos are still being looked at. */
export async function nudgeArchival(asMemberId?: string): Promise<{ remaining: number }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { remaining: 0 }
  const r = await processWardrobeQueue(35_000)
  await readArchivalLooks(me.memberId, 3).catch(() => undefined)
  return { remaining: r.remaining }
}

async function ownsExtraction(memberId: string, extractionId: string): Promise<boolean> {
  const admin = createAdminClient() as any
  const { data } = await admin.from('wardrobe_extraction').select('owner_user_id, owner_kind').eq('extraction_id', extractionId).maybeSingle()
  return !!data && data.owner_user_id === memberId && data.owner_kind === 'pilot_member'
}

/** She still owns it: the piece MYRA spotted goes onto her rail. */
export async function addArchivalPiece(extractionId: string, asMemberId?: string): Promise<{ itemId?: string; error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { error: 'Not signed in' }
  return approveExtraction(extractionId, {}, { allowedOwners: [ownerOf(me.memberId)] })
}

export async function dismissArchivalPiece(extractionId: string, asMemberId?: string): Promise<{ error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { error: 'Not signed in' }
  if (!(await ownsExtraction(me.memberId, extractionId))) return { error: 'Not yours' }
  return discardExtraction(extractionId)
}

export async function removeArchivalLook(lookId: string, asMemberId?: string): Promise<{ error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { error: 'Not signed in' }
  return hideArchivalLook(me.memberId, lookId)
}

export async function disconnectArchivalInstagram(connectionId: string, asMemberId?: string): Promise<{ error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { error: 'Not signed in' }
  return disconnectInstagram(me.memberId, connectionId)
}
