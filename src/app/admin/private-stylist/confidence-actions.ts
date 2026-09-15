'use server'

// WOULD THIS LOOK HAVE PASSED?
//
// The confidence score exists to decide what a client can be sent without
// review. Before it decides anything it has to be visible, and checkable
// against looks whose outcome is already known — a score nobody can see is a
// claim, not a measurement.
//
// Everything here is derived on read from her own history. Nothing is stored,
// so the number can never disagree with the looks it came from.

import { createAdminClient, createServerClient } from '@/lib/supabase-server'
import { previewAskLooks, type AskPreviewLook } from './actions'
import { pieceVerdicts } from '@/lib/piece-verdicts'
import { judgeLooksForMember, hasPieceOutOfSize, type LookCheck } from '@/lib/look-check'
import type { PieceSize } from '@/lib/look-size-check'
import { revalidatePath } from 'next/cache'
import {
  lookConfidence, calibrateThreshold, indexHistory, historySignals,
  HIGH_CONFIDENCE, type LookRecord, type Calibration,
} from '@/lib/look-confidence'

const PATH = '/admin/private-stylist'

/** Every feedback row, oldest first — paged past PostgREST's 1,000-row cap. */
async function feedbackRows(admin: any, memberId: string): Promise<{ data: any[] }> {
  const out: any[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from('pilot_look_feedback')
      .select('look_id, action, item_out, item_in, created_at')
      .eq('member_id', memberId).order('created_at', { ascending: true }).range(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return { data: out }
}

export interface LookConfidenceRow {
  look_id: string
  score: number
  high: boolean
  reasons: string[]
  /** Known outcome, where there is one — so the score can be judged. */
  wasClean: boolean | null
}

export interface MemberConfidence {
  byLook: Record<string, LookConfidenceRow>
  calibration: Calibration
  threshold: number
  error?: string
}

/**
 * Score every look she has, each from the looks that came before it.
 *
 * Walking forward matters: scoring a look with its own outcome in the index
 * would make the number look far better than it is, and the whole purpose is
 * to know whether it can be trusted on a look nobody has seen yet.
 */
export async function loadMemberConfidence(memberId: string): Promise<MemberConfidence> {
  const empty: MemberConfidence = {
    byLook: {},
    calibration: { threshold: HIGH_CONFIDENCE, separation: 0, cleanMean: 0, editedMean: 0, sample: 0, precision: 0, lift: 0, reaching: 0, usable: false },
    threshold: HIGH_CONFIDENCE,
  }
  try {
    const admin = createAdminClient() as any
    const { data: dels } = await admin.from('pilot_delivery').select('delivery_id').eq('member_id', memberId)
    const ids = (dels ?? []).map((d: any) => d.delivery_id)
    if (!ids.length) return empty

    const [{ data: looks }, { data: fb }] = await Promise.all([
      admin.from('pilot_look').select('look_id, items, approved_at, response, created_at').in('delivery_id', ids).order('created_at'),
      feedbackRows(admin, memberId),
    ])
    const edited = new Set((fb ?? []).filter((f: any) => f.look_id && f.action !== 'accept').map((f: any) => f.look_id))
    // Only pieces whose MOST RECENT answer was a rejection — a piece swapped
    // out and straight back in, or kept since, is not held against a look.
    const rejected = pieceVerdicts(fb ?? []).rejected

    // Which pieces the composer was blind on — no scored dimensions.
    const allIds = new Set<string>()
    for (const l of looks ?? []) for (const it of ((l.items ?? []) as any[])) if (it.item_id) allIds.add(it.item_id)
    const scored = new Set<string>()
    const arr = Array.from(allIds)
    for (let i = 0; i < arr.length; i += 100) {
      const { data } = await admin.from('item').select('item_id, structure').in('item_id', arr.slice(i, i + 100))
      for (const r of data ?? []) if (r.structure != null) scored.add(r.item_id)
    }

    const past: LookRecord[] = []
    const byLook: Record<string, LookConfidenceRow> = {}
    const history: { score: number; wasClean: boolean }[] = []

    for (const l of (looks ?? []) as any[]) {
      const items = (l.items ?? []) as any[]
      const itemIds = items.map((i) => i.item_id).filter(Boolean)
      const brandIds = items.map((i) => i.brand_id).filter(Boolean)
      const decided = !!l.approved_at || edited.has(l.look_id)
      const wasClean = decided ? !edited.has(l.look_id) : null

      if (itemIds.length) {
        const h = indexHistory(past)
        const c = lookConfidence({
          constitutionPassed: true,
          containsRejected: itemIds.some((id: string) => rejected.has(id)),
          containsBlockedTrait: false,
          ...historySignals(h, itemIds, brandIds),
          usedFallbackPool: false,
          unscoredShare: itemIds.filter((id: string) => !scored.has(id)).length / itemIds.length,
        })
        byLook[l.look_id] = { look_id: l.look_id, score: c.score, high: c.high, reasons: c.reasons, wasClean }
        // Only decided looks can judge the gate, and only from past evidence.
        if (decided && past.length >= 3) history.push({ score: c.score, wasClean: wasClean === true })
      }

      if (decided) past.push({ itemIds, brandIds, kept: wasClean === true && (!!l.approved_at || l.response === 'yes') })
    }

    return { byLook, calibration: calibrateThreshold(history), threshold: HIGH_CONFIDENCE }
  } catch (err) {
    return { ...empty, error: err instanceof Error ? err.message : 'Could not score her looks' }
  }
}

// ── Sending looks to her ────────────────────────────────────────────────────

/**
 * Give a client an account, and point it at her member record.
 *
 * pilot_member.auth_user_id is the join that did not exist: every look lives
 * under a member, and nothing connected a member to somebody who could log in.
 */
export async function createClientLogin(
  memberId: string,
  email: string,
): Promise<{ email?: string; password?: string; url?: string; error?: string }> {
  // Creating a login is admin-only — this is a server action anyone could call.
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.id !== process.env.ADMIN_USER_ID) return { error: 'Not authorised' }
  const clean = (email ?? '').trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) return { error: 'Enter a valid email address' }
  const admin = createAdminClient() as any
  try {
    const { data: member } = await admin.from('pilot_member').select('name, auth_user_id').eq('member_id', memberId).single()
    if (!member) return { error: 'Member not found' }
    if (member.auth_user_id) return { error: 'She already has a login' }

    const words = ['linen', 'atelier', 'ivory', 'camel', 'poplin', 'saison']
    const password = `${words[Math.floor(Math.random() * words.length)]}-${Math.floor(1000 + Math.random() * 9000)}-myra`
    const { data: created, error } = await admin.auth.admin.createUser({
      email: clean,
      password,
      email_confirm: true, // no email step for a pilot of one
      user_metadata: { role: 'client', name: member.name },
    })
    if (error) return { error: /already|registered/i.test(error.message) ? 'An account with that email already exists' : error.message }

    await admin.from('pilot_member').update({ auth_user_id: created.user!.id }).eq('member_id', memberId)
    await admin.from('client_profile').upsert(
      { user_id: created.user!.id, name: member.name, email: clean },
      { onConflict: 'user_id' },
    )
    revalidatePath(PATH)
    const base = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
    return { email: clean, password, url: `${base}/signin` }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not create the login' }
  }
}

/**
 * Send a look to her, and tell her it is there.
 *
 * One tap rather than an automatic gate: the confidence score is measurably
 * better than chance on her history but not yet on enough looks to publish
 * unwatched, so publishing stays a decision until it is.
 */
export async function sendLookToClient(lookId: string): Promise<{ error?: string }> {
  const admin = createAdminClient() as any
  try {
    const { data: look } = await admin
      .from('pilot_look').select('look_id, image_url, delivery:delivery_id!inner(member_id)')
      .eq('look_id', lookId).maybeSingle()
    if (!look) return { error: 'Look not found' }
    if (!look.image_url) return { error: 'Shoot it first — she should see the look, not the parts' }

    await admin.from('pilot_look')
      .update({ visible_to_client: true, published_at: new Date().toISOString() })
      .eq('look_id', lookId)
    await admin.from('pilot_notification').insert({
      member_id: (look.delivery as any).member_id,
      kind: 'looks_ready',
      body: 'A new look is waiting for you.',
      look_ids: [lookId],
    })
    revalidatePath(PATH)
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not send it' }
  }
}

/** Take a look back — she stops seeing it, and nothing she said is undone. */
export async function unsendLook(lookId: string): Promise<{ error?: string }> {
  const admin = createAdminClient() as any
  const { error } = await admin.from('pilot_look')
    .update({ visible_to_client: false }).eq('look_id', lookId)
  if (error) return { error: error.message }
  revalidatePath(PATH)
  return {}
}

/** Every shot look she has not been sent yet, sent at once. */
export async function sendAllShotLooks(memberId: string): Promise<{ sent: number; error?: string }> {
  const admin = createAdminClient() as any
  try {
    const { data: dels } = await admin.from('pilot_delivery').select('delivery_id').eq('member_id', memberId)
    const ids = (dels ?? []).map((d: any) => d.delivery_id)
    if (!ids.length) return { sent: 0 }
    const { data: looks } = await admin.from('pilot_look')
      .select('look_id').in('delivery_id', ids)
      .not('image_url', 'is', null).eq('visible_to_client', false)
    const lookIds = (looks ?? []).map((l: any) => l.look_id)
    if (!lookIds.length) return { sent: 0 }
    await admin.from('pilot_look')
      .update({ visible_to_client: true, published_at: new Date().toISOString() })
      .in('look_id', lookIds)
    await admin.from('pilot_notification').insert({
      member_id: memberId,
      kind: 'looks_ready',
      body: `${lookIds.length} looks are waiting for you.`,
      look_ids: lookIds,
    })
    revalidatePath(PATH)
    return { sent: lookIds.length }
  } catch (err) {
    return { sent: 0, error: err instanceof Error ? err.message : 'Could not send them' }
  }
}


export type ScoredAskLook = AskPreviewLook & {
  score: number
  high: boolean
  reasons: string[]
  /** Claude's eye on the photos — null when it could not run. */
  check: LookCheck | null
  /** Each piece's size verdict, by item_id. */
  sizes: Record<string, PieceSize>
}

export interface AskPreviewResult {
  looks: ScoredAskLook[]
  mix: Record<string, number>
  /** Whether the look check ran, so the % means something. */
  scoreUsable: boolean
  /** Looks composed but not shown because they clashed or held a piece not in her size. */
  hiddenByCheck?: number
  /** Why, in the check's words. */
  hiddenIssues?: string[]
  error?: string
}

/** Looks the test shows. Two spares are composed so a failed look is replaced, not shown. */
const ASK_LOOKS = 3
const ASK_SPARES = 2

/**
 * TEST RUN of "Ask MYRA" for one member, from the admin mirror.
 *
 * The real composer on her real history, each look scored against everything
 * she has decided so far — the same score the send gate will use. Nothing is
 * written: no delivery, no look rows, no notification, no learning.
 */
export async function previewAskForMember(
  memberId: string,
  occasion: string,
  climate: string | null,
): Promise<AskPreviewResult> {
  const empty: AskPreviewResult = { looks: [], mix: {}, scoreUsable: false }
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.id !== process.env.ADMIN_USER_ID) return { ...empty, error: 'Not authorised' }

  const planned = await previewAskLooks(memberId, occasion, climate, ASK_LOOKS + ASK_SPARES)
  if (planned.error || !planned.looks) return { ...empty, error: planned.error ?? 'Could not compose' }

  try {
    // The check runs BEFORE anything is shown: a look that clashes, or holds a
    // piece not in her size, is replaced by a spare rather than put in front of
    // you. Best verdicts first. If nothing passes, all are shown, flagged.
    const scored = await scoreLooksAgainstHistory(memberId, planned.looks)
    const fails = (l: ScoredAskLook) => l.check?.verdict === 'clashes' || hasPieceOutOfSize({ check: l.check, sizes: l.sizes })
    const rank = (l: ScoredAskLook) => (l.check?.verdict === 'works' ? 0 : l.check ? 1 : 2)
    const passing = scored.filter((l) => !fails(l)).sort((a, b) => rank(a) - rank(b) || b.score - a.score)
    const failed = scored.filter(fails)
    const looks = passing.length ? passing.slice(0, ASK_LOOKS) : scored.slice(0, ASK_LOOKS)
    return {
      mix: planned.mix ?? {},
      scoreUsable: scored.some((l) => l.check),
      looks,
      hiddenByCheck: passing.length ? failed.length : 0,
      hiddenIssues: passing.length ? failed.flatMap((l) => l.reasons.slice(0, 1)) : [],
    }
  } catch (err) {
    return { ...empty, error: err instanceof Error ? err.message : 'Could not score the test looks' }
  }
}


/**
 * Score unsaved looks — shared by the test run and its rescore-after-swap, so a
 * swapped look is judged exactly as a composed one.
 *
 * The % is Claude's eye on the photos (look-check). History alone could not
 * predict what Chloe accepts: walk-forward on 60 of Alison's looks the history
 * score correlated 0.06 with acceptance, and the looks she accepted straight
 * away scored 28–40%. The history signals stay as reasons, and a piece no
 * longer in her size caps the look at 30%.
 */
async function scoreLooksAgainstHistory(
  memberId: string,
  looks: AskPreviewLook[],
): Promise<ScoredAskLook[]> {
  const admin = createAdminClient() as any
  const judged = await judgeLooksForMember(admin, memberId, looks, 'unknown')
  const { data: dels } = await admin.from('pilot_delivery').select('delivery_id').eq('member_id', memberId)
  const ids = (dels ?? []).map((d: any) => d.delivery_id)
  const [{ data: past }, { data: fb }] = await Promise.all([
    ids.length
      ? admin.from('pilot_look').select('look_id, items, approved_at, response').in('delivery_id', ids)
      : Promise.resolve({ data: [] }),
    feedbackRows(admin, memberId),
  ])
  const edited = new Set((fb ?? []).filter((f: any) => f.look_id && f.action !== 'accept').map((f: any) => f.look_id))
  const rejected = pieceVerdicts(fb ?? []).rejected
  const records: LookRecord[] = []
  for (const l of (past ?? []) as any[]) {
    const decided = !!l.approved_at || edited.has(l.look_id) || !!l.response
    if (!decided) continue
    const items = (l.items ?? []) as any[]
    records.push({
      itemIds: items.map((i) => i.item_id).filter(Boolean),
      brandIds: items.map((i) => i.brand_id).filter(Boolean),
      kept: !edited.has(l.look_id) && l.response !== 'no' && (!!l.approved_at || l.response === 'yes'),
    })
  }
  const h = indexHistory(records)
  return looks.map((l, i) => {
    const itemIds = l.items.map((i: any) => i.item_id).filter(Boolean)
    const brandIds = l.items.map((i: any) => i.brand_id).filter(Boolean)
    const c = lookConfidence({
      constitutionPassed: true,
      containsRejected: itemIds.some((id: string) => rejected.has(id)),
      containsBlockedTrait: false,
      ...historySignals(h, itemIds, brandIds),
      usedFallbackPool: false,
      unscoredShare: 0,
    })
    const j = judged[i]
    const outOfSize = hasPieceOutOfSize(j)
    let score = j.check ? j.check.confidence : c.score
    if (outOfSize) score = Math.min(score, 0.3)
    const sizeReasons = l.items
      .filter((it: any) => it.item_id && j.sizes[it.item_id]?.verdict === 'not_in_size')
      .map((it: any) => `${it.product_name} is not in her size`)
    return {
      ...l,
      score,
      high: !!j.check && j.check.verdict === 'works' && score >= HIGH_CONFIDENCE && !outOfSize,
      reasons: [...sizeReasons, ...(j.check?.issues ?? []), ...c.reasons],
      check: j.check,
      sizes: j.sizes,
    }
  })
}

/** TEST: rescore one look after a swap in the test panel. Writes nothing. */
export async function rescoreAskLook(
  memberId: string,
  look: AskPreviewLook,
): Promise<{ score?: number; high?: boolean; reasons?: string[]; check?: LookCheck | null; sizes?: Record<string, PieceSize>; error?: string }> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.id !== process.env.ADMIN_USER_ID) return { error: 'Not authorised' }
  try {
    const [scored] = await scoreLooksAgainstHistory(memberId, [look])
    return { score: scored.score, high: scored.high, reasons: scored.reasons, check: scored.check, sizes: scored.sizes }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not rescore' }
  }
}
