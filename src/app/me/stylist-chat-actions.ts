'use server'

// HER STYLISTS, IN CONVERSATION — the chat drawer on every one of her pages.
//
// The member is resolved on the server (her session, or the member Chloe
// names from HER VIEW). Testing as her writes nothing: the thread lives for
// the drawer and is gone when it closes.

import { createAdminClient } from '@/lib/supabase-server'
import { resolveClientMember } from '@/lib/client-member'
import { listStylists, getStylist } from '@/lib/stylist-store'
import { replyAsStylist, type ChatTurn, type ChatLook } from '@/lib/stylist-chat'
import type { ItemAnswer } from '@/lib/mcp/myra-tools'

export interface ChatStylist {
  stylist_id: string
  slug: string
  name: string
  tagline: string
  image_url: string | null
  chief: boolean
  /** Her reference outfits are confirmed and her eye is built. */
  ready: boolean
  /** Assigned to this member. */
  hers: boolean
}

export interface ChatMessage extends ChatTurn {
  message_id: string
  created_at: string
}

/** Sciura first, then every persona stylist with a brief. */
export async function listChatStylists(asMemberId?: string): Promise<{ stylists: ChatStylist[]; memberName: string; test: boolean; error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { stylists: [], memberName: '', test: false, error: 'Not signed in' }
  const admin = createAdminClient() as any
  const [all, { data: assignment }] = await Promise.all([
    listStylists(),
    admin.from('user_persona').select('persona_id').eq('user_id', me.memberId).maybeSingle(),
  ])
  const stylists = all
    .filter((s) => s.type === 'persona' && (s.role === 'chief' || s.brief.brands.length || s.brief.signature_pieces.length))
    .sort((a, b) => Number(b.role === 'chief') - Number(a.role === 'chief'))
    .map((s) => ({
      stylist_id: s.stylist_id, slug: s.slug, name: s.brief.public_name || s.name, tagline: s.brief.tagline,
      image_url: s.brief.image_url ?? null, chief: s.role === 'chief',
      ready: s.role === 'chief' || !!s.envelope?.mean?.length, hers: assignment?.persona_id === s.stylist_id,
    }))
  return { stylists, memberName: me.name, test: me.test }
}

export async function loadStylistThread(stylistId: string, asMemberId?: string): Promise<{ messages: ChatMessage[]; error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { messages: [], error: 'Not signed in' }
  if (me.test) return { messages: [] }
  const admin = createAdminClient() as any
  const { data } = await admin.from('stylist_chat_message').select('*')
    .eq('member_id', me.memberId).eq('stylist_id', stylistId).order('created_at', { ascending: true }).limit(60)
  return {
    messages: ((data ?? []) as any[]).map((m) => ({
      message_id: m.message_id, role: m.role, body: m.body, created_at: m.created_at,
      looks: Array.isArray(m.looks) ? (m.looks as ChatLook[]) : [], items: Array.isArray(m.items) ? (m.items as ItemAnswer[]) : [],
    })),
  }
}

export async function sendToStylist(
  stylistId: string,
  message: string,
  history: ChatTurn[],
  asMemberId?: string,
): Promise<{ reply?: ChatMessage; error?: string }> {
  const me = await resolveClientMember(asMemberId)
  if (!me) return { error: 'Not signed in' }
  const body = (message ?? '').trim().slice(0, 1500)
  if (!body) return { error: 'Say something first' }
  const stylist = await getStylist(stylistId)
  if (!stylist || stylist.type !== 'persona') return { error: 'No such stylist' }

  const reply = await replyAsStylist(me.memberId, me.name, stylist, history, body)
  if (reply.error) return { error: reply.error }
  const now = new Date().toISOString()

  if (!me.test) {
    const admin = createAdminClient() as any
    await admin.from('stylist_chat_message').insert([
      { member_id: me.memberId, stylist_id: stylistId, role: 'member', body },
      { member_id: me.memberId, stylist_id: stylistId, role: 'stylist', body: reply.body, looks: reply.looks, items: reply.items },
    ])
  }
  return { reply: { message_id: `r-${Date.now()}`, role: 'stylist', body: reply.body, looks: reply.looks, items: reply.items, created_at: now } }
}
