// OUTFIT REVIEW PROJECTS — briefs MYRA composes in the background (migration 0119).
//
// Outfit Review composed one anchor at a time while Chloe watched. A project
// is a brief she hands over and walks away from: "fur coats", "midi skirts,
// three ways", "New Year's Eve party outfits", or one piece from a screenshot.
// MYRA reads the brief into asks the composer understands, picks ~20 anchors
// for it, composes looks for each (the same recipes Review uses: composeFromAsk
// for a brief, composeForReview for a piece) and KEEPS every look, so she can
// open the project later, pick the ones good enough for content, and send
// those to Higgsfield — while the next project composes.
//
// Queue: review_project.status is the state. A drain claims one queued
// project at a time and heartbeats per anchor; a run cut off by Vercel's 300s
// goes back to `queued` with anchors_tried kept, and continues from there.
// Shoots are a second queue on the looks (shoot_status), drained alongside.
// Kicked the moment a project or a pick is made (kickReviewProjectsDrain) and
// swept by /api/cron/review-projects.

import 'server-only'
import { waitUntil } from '@vercel/functions'
import Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '@/lib/supabase-server'
import { getItem, getReadyAndLiveItems } from '@/lib/admin-queries'
import { composeFromAsk } from '@/app/admin/composer/ask-actions'
import { composeForReview, type ReviewCandidate, type ReviewItem } from '@/app/admin/outfit-review/actions'
import { approveCandidate, recordSkipDecision, rescoreCandidate } from '@/app/admin/composer/actions'
import { generateHiggsfieldShootForOutfit } from '@/app/admin/projects/higgsfield-actions'
import { parseOutfitAsk } from '@/lib/outfit-ask'
import { reviewAnchorKind } from '@/lib/review-compose'
import { slotForItemType, type Slot } from '@/lib/composer'
import { siteUrl } from '@/lib/studio/email'
import { askForLook, bySignature, strongestBySignature, spreadByColour, WAY_CLOSE, WAY_STYLE, type ProjectInspiration } from '@/lib/review-inspiration'
import { matchInspiration, composeInspirationLooks, colourFamilyOf } from '@/lib/review-inspiration-match'

export type ProjectKind = 'looks' | 'three_ways' | 'inspiration'
export type ProjectStatus = 'queued' | 'running' | 'done' | 'failed' | 'paused'
export type LookDecision = 'pending' | 'picked' | 'skipped'
export type ShootStatus = 'queued' | 'running' | 'done' | 'failed'

/** The anchor as the Review card shows it (anchorPayload / piecePayload). */
export interface ProjectAnchor {
  item_id: string
  product_name: string
  brand_name: string | null
  image_url: string
  item_type: string
  price: string
  colour_family?: string | null
  stock_status?: string | null
  stock_sizes?: string[] | null
}

/** One planned anchor: the ask it came from (null = the piece itself) and the piece. */
interface PlanStep { anchorId: string; ask: string | null; occasion?: string | null; way?: string | null }

export interface ReviewProject {
  project_id: string
  title: string
  brief: string | null
  kind: ProjectKind
  anchor_item_id: string | null
  anchor: ProjectAnchor | null
  /** kind 'inspiration': the picture of a look the project is in the style of, as MYRA read it. */
  inspiration: ProjectInspiration | null
  target_anchors: number
  plan: PlanStep[] | null
  anchors_total: number
  anchors_tried: number
  looks_count: number
  status: ProjectStatus
  attempts: number
  error: string | null
  notes: string[]
  admin_project_id: string | null
  created_at: string
  started_at: string | null
  heartbeat_at: string | null
  finished_at: string | null
}

export interface ReviewProjectLook {
  look_id: string
  project_id: string
  anchor_index: number
  anchor_item_id: string
  anchor: ProjectAnchor
  way_label: string | null
  items: ReviewItem[]
  score: number | null
  confidence: number | null
  lane: 'fast' | 'standard' | null
  reasons: string[]
  statement: string | null
  echoes: string[]
  decision: LookDecision
  outfit_id: string | null
  shoot_status: ShootStatus | null
  shoot_url: string | null
  shoot_error: string | null
  created_at: string
  picked_at: string | null
}

/** A project in the list, with where its looks stand. */
export interface ReviewProjectSummary extends ReviewProject {
  picked: number
  pending: number
  shot: number
  shooting: number
  cover: string | null
}

const MIGRATION_HINT = 'Run migration 0119 (npm run migrate) first'
const migrationError = (msg: string | undefined | null) =>
  msg && /inspiration|kind_check/i.test(msg) ? 'Run migration 0122 (npm run migrate) first'
    : msg && /review_project|schema cache|does not exist/i.test(msg) ? MIGRATION_HINT : msg ?? 'Database error'

/** A look project: this many anchors in all, the first of them closest to the picture; this many looks kept of each. */
const INSPIRATION_ANCHORS = 8
const INSPIRATION_CLOSE_ANCHORS = 2
const INSPIRATION_LOOKS_PER_ANCHOR = 2

/** A running project that has not heartbeated in this long was killed with its function. */
const STALE_MS = 4 * 60_000
const MAX_ATTEMPTS = 3
/** A shoot still `running` after this is lost (the CLI waits ~3 minutes at most). */
const SHOOT_STALE_MS = 8 * 60_000
/** A shoot needs this much of the budget left to be started. */
const SHOOT_RESERVE_MS = 150_000
const KICK_THROTTLE_MS = 10_000
let lastKickAt = 0

const nowIso = () => new Date().toISOString()

// ── Reading ────────────────────────────────────────────────────────────────

function rowToProject(r: any): ReviewProject {
  return {
    ...r,
    anchor: r.anchor ?? null,
    inspiration: r.inspiration ?? null,
    plan: Array.isArray(r.plan) ? r.plan : null,
    notes: Array.isArray(r.notes) ? r.notes : [],
  }
}

function rowToLook(r: any): ReviewProjectLook {
  return {
    ...r,
    items: Array.isArray(r.items) ? r.items : [],
    reasons: Array.isArray(r.reasons) ? r.reasons : [],
    echoes: Array.isArray(r.echoes) ? r.echoes : [],
    score: r.score == null ? null : Number(r.score),
    confidence: r.confidence == null ? null : Number(r.confidence),
  }
}

export async function listReviewProjects(limit = 60): Promise<{ projects: ReviewProjectSummary[]; error?: string }> {
  const admin = createAdminClient() as any
  const { data, error } = await admin.from('review_project').select('*').order('created_at', { ascending: false }).limit(limit)
  if (error) return { projects: [], error: migrationError(error.message) }
  const projects = ((data ?? []) as any[]).map(rowToProject)
  const ids = projects.map((p) => p.project_id)
  const tally = new Map<string, { picked: number; pending: number; shot: number; shooting: number; cover: string | null }>()
  for (const id of ids) tally.set(id, { picked: 0, pending: 0, shot: 0, shooting: 0, cover: null })
  if (ids.length) {
    const { data: looks } = await admin.from('review_project_look')
      // Only what the tally needs: the anchor's picture, not the whole anchor (half a megabyte on every poll).
      .select('project_id, decision, shoot_status, shoot_url, cover:anchor->>image_url')
      .in('project_id', ids)
    for (const l of (looks ?? []) as any[]) {
      const t = tally.get(l.project_id)
      if (!t) continue
      if (l.decision === 'picked') t.picked++
      if (l.decision === 'pending') t.pending++
      if (l.shoot_status === 'done') t.shot++
      if (l.shoot_status === 'queued' || l.shoot_status === 'running') t.shooting++
      // The cover is the first shot, else the first anchor's picture.
      if (l.shoot_url && (!t.cover || !/shoot|hf_|higgs/i.test(t.cover))) t.cover = l.shoot_url
      else if (!t.cover && l.cover) t.cover = l.cover
    }
  }
  return {
    projects: projects.map((p) => ({ ...p, ...(tally.get(p.project_id) ?? { picked: 0, pending: 0, shot: 0, shooting: 0, cover: null }), cover: tally.get(p.project_id)?.cover ?? p.anchor?.image_url ?? p.inspiration?.image_url ?? null })),
  }
}

export async function getReviewProject(projectId: string): Promise<{ project?: ReviewProject; looks: ReviewProjectLook[]; error?: string }> {
  const admin = createAdminClient() as any
  const [{ data: p, error }, { data: looks, error: lErr }] = await Promise.all([
    admin.from('review_project').select('*').eq('project_id', projectId).maybeSingle(),
    admin.from('review_project_look').select('*').eq('project_id', projectId).order('anchor_index').order('created_at'),
  ])
  if (error || lErr) return { looks: [], error: migrationError((error ?? lErr)?.message) }
  if (!p) return { looks: [], error: 'Project not found' }
  return { project: rowToProject(p), looks: ((looks ?? []) as any[]).map(rowToLook) }
}

// ── Creating ───────────────────────────────────────────────────────────────

/** "fur coats" → "FUR COATS"; a screenshot project is named for its piece. */
export function titleFor(brief: string | null, anchor: ProjectAnchor | null, kind: ProjectKind): string {
  const base = (brief?.trim() || [anchor?.brand_name, anchor?.product_name].filter(Boolean).join(' ') || 'Untitled').replace(/\s+/g, ' ')
  const t = base.length > 60 ? `${base.slice(0, 57).trim()}…` : base
  return kind === 'three_ways' && !/three ways|3 ways/i.test(t) ? `${t} · three ways` : t
}

export async function createReviewProject(input: {
  brief?: string | null
  kind?: ProjectKind
  anchor?: ProjectAnchor | null
  /** A picture of a whole look, read (lib/review-inspiration): the project composes outfits in its style. */
  inspiration?: ProjectInspiration | null
  targetAnchors?: number
  title?: string | null
  /** Create it paused and unkicked, for a caller that composes it itself (runReviewProjectNow). */
  hold?: boolean
}): Promise<{ project?: ReviewProject; error?: string }> {
  const brief = (input.brief ?? '').trim() || null
  const inspiration = input.inspiration ?? null
  const anchor = inspiration ? null : input.anchor ?? null
  const kind: ProjectKind = inspiration ? 'inspiration' : input.kind === 'three_ways' ? 'three_ways' : 'looks'
  if (!brief && !anchor && !inspiration) return { error: 'Say what the project is about, or hand MYRA a screenshot' }
  const target = inspiration ? INSPIRATION_ANCHORS : anchor ? 1 : Math.min(60, Math.max(3, Math.round(input.targetAnchors ?? 20)))
  const admin = createAdminClient() as any
  const { data, error } = await admin.from('review_project').insert({
    title: (input.title?.trim() || titleFor(brief ?? inspiration?.title ?? null, anchor, kind)).slice(0, 120),
    brief, kind,
    anchor_item_id: anchor?.item_id ?? null,
    anchor,
    target_anchors: target,
    status: input.hold ? 'paused' : 'queued',
    // Only named when there is one, so the other kinds work before migration 0122.
    ...(inspiration ? { inspiration } : {}),
  }).select('*').single()
  if (error) return { error: migrationError(error.message) }
  if (!input.hold) kickReviewProjectsDrain()
  return { project: rowToProject(data) }
}

export async function setReviewProjectStatus(projectId: string, status: 'paused' | 'queued'): Promise<{ error?: string }> {
  const admin = createAdminClient() as any
  const { error } = await admin.from('review_project').update({ status, error: null }).eq('project_id', projectId).in('status', status === 'paused' ? ['queued', 'running'] : ['paused', 'failed'])
  if (error) return { error: error.message }
  if (status === 'queued') kickReviewProjectsDrain()
  return {}
}

export async function deleteReviewProject(projectId: string): Promise<{ error?: string }> {
  const admin = createAdminClient() as any
  const { error } = await admin.from('review_project').delete().eq('project_id', projectId)
  return error ? { error: error.message } : {}
}

// ── Picks ──────────────────────────────────────────────────────────────────

/** The Outfit Project (admin_project) a review project's picks are filed under — made on the first pick. */
async function ensureAdminProject(admin: any, project: ReviewProject): Promise<string | null> {
  if (project.admin_project_id) return project.admin_project_id
  const { data, error } = await admin.from('admin_project').insert({
    title: project.title.toUpperCase(),
    status: 'draft',
    outfit_ids: [],
    notes: `Outfit Review project${project.brief ? ` — “${project.brief}”` : ''}. Picked looks land here as drafts; the Higgsfield shoot becomes each one's display image.`,
  }).select('project_id').single()
  if (error || !data) { console.error('[review-projects] admin project', error); return null }
  await admin.from('review_project').update({ admin_project_id: data.project_id }).eq('project_id', project.project_id)
  return data.project_id as string
}

/**
 * YES: the look becomes a draft outfit (approveCandidate — the same YES as the
 * Review card, so Style Brain learns it) filed under the project's Outfit
 * Project, and its Higgsfield shoot is queued for the drain.
 */
export async function pickReviewLook(lookId: string): Promise<{ look?: ReviewProjectLook; error?: string }> {
  const admin = createAdminClient() as any
  const { data: l, error } = await admin.from('review_project_look').select('*').eq('look_id', lookId).maybeSingle()
  if (error || !l) return { error: error?.message ?? 'Look not found' }
  const look = rowToLook(l)
  if (look.decision === 'picked' && look.outfit_id) return { look }
  const { data: p } = await admin.from('review_project').select('*').eq('project_id', look.project_id).maybeSingle()
  if (!p) return { error: 'Project not found' }
  const project = rowToProject(p)
  const adminProjectId = await ensureAdminProject(admin, project)
  const res = await approveCandidate(
    look.anchor_item_id,
    look.items.map((i) => i.item_id),
    look.items.map((i) => i.slot as Slot),
    { autoShoot: false, source: 'review', score: look.score ?? undefined, projectId: adminProjectId },
  )
  if (res.error || !res.outfitId) return { error: res.error ?? 'Could not make the outfit' }
  const { data: updated, error: uErr } = await admin.from('review_project_look')
    .update({ decision: 'picked', outfit_id: res.outfitId, shoot_status: 'queued', shoot_error: null, picked_at: nowIso() })
    .eq('look_id', lookId).select('*').single()
  if (uErr) return { error: uErr.message }
  kickReviewProjectsDrain()
  return { look: rowToLook(updated) }
}

export async function skipReviewLook(lookId: string): Promise<{ look?: ReviewProjectLook; error?: string }> {
  const admin = createAdminClient() as any
  const { data: l } = await admin.from('review_project_look').select('*').eq('look_id', lookId).maybeSingle()
  if (!l) return { error: 'Look not found' }
  const look = rowToLook(l)
  if (look.decision === 'picked') return { error: 'Already picked — open the draft to archive it' }
  const { data, error } = await admin.from('review_project_look').update({ decision: 'skipped' }).eq('look_id', lookId).select('*').single()
  if (error) return { error: error.message }
  void recordSkipDecision(look.anchor_item_id, look.items.map((i) => i.item_id), 'review', look.score ?? undefined).catch(() => {})
  return { look: rowToLook(data) }
}

/** Undo a skip. */
export async function restoreReviewLook(lookId: string): Promise<{ look?: ReviewProjectLook; error?: string }> {
  const admin = createAdminClient() as any
  const { data, error } = await admin.from('review_project_look').update({ decision: 'pending' }).eq('look_id', lookId).eq('decision', 'skipped').select('*').maybeSingle()
  if (error) return { error: error.message }
  if (!data) return { error: 'Only a skipped look can be restored' }
  return { look: rowToLook(data) }
}

/** A swap or a removal on a pending look: the pieces change, the score follows. */
export async function editReviewLook(lookId: string, items: ReviewItem[]): Promise<{ look?: ReviewProjectLook; error?: string }> {
  const admin = createAdminClient() as any
  const { data: l } = await admin.from('review_project_look').select('*').eq('look_id', lookId).maybeSingle()
  if (!l) return { error: 'Look not found' }
  if (l.decision === 'picked') return { error: 'Already picked — edit the draft outfit instead' }
  const clean: ReviewItem[] = items
    .filter((i) => i && typeof i.item_id === 'string' && typeof i.slot === 'string')
    .map((i) => ({
      slot: i.slot, item_id: i.item_id, product_name: String(i.product_name ?? ''), brand_name: i.brand_name ?? null,
      image_url: String(i.image_url ?? ''), price: String(i.price ?? ''), compat: Number(i.compat ?? 0),
      stock_status: i.stock_status ?? null, stock_sizes: i.stock_sizes ?? null,
    }))
  if (clean.length === 0) return { error: 'A look needs at least one piece beside the anchor' }
  const re = await rescoreCandidate(l.anchor_item_id, clean.map((i) => ({ itemId: i.item_id, slot: i.slot as Slot })))
  const patch: Record<string, unknown> = { items: clean }
  if (typeof re.score === 'number') patch.score = re.score
  if (re.itemCompat) for (const it of clean) if (typeof re.itemCompat[it.item_id] === 'number') it.compat = Number(re.itemCompat[it.item_id].toFixed(3))
  const { data, error } = await admin.from('review_project_look').update(patch).eq('look_id', lookId).select('*').single()
  if (error) return { error: error.message }
  return { look: rowToLook(data) }
}

/** Shoot again (a failed shoot, or another take). */
export async function reshootReviewLook(lookId: string): Promise<{ error?: string }> {
  const admin = createAdminClient() as any
  const { error } = await admin.from('review_project_look').update({ shoot_status: 'queued', shoot_error: null })
    .eq('look_id', lookId).eq('decision', 'picked').not('outfit_id', 'is', null)
  if (error) return { error: error.message }
  kickReviewProjectsDrain()
  return {}
}

// ── The brief → asks ───────────────────────────────────────────────────────

// What the composer's sentence reader knows, for the brief reader's prompt.
const TYPE_WORDS = 'coat, trench coat, jacket, blazer, gilet, cape, shirt, blouse, t-shirt, knitwear (jumper, cardigan), corset, bodysuit, trousers, jeans, shorts, skirt (mini, midi, maxi), mini dress, midi dress, maxi dress, shirt dress, slip dress, heels, flats, sandals, mules, boots, sneakers, tote, shoulder bag, clutch, crossbody bag'
const CLOTH_WORDS = 'silk, satin, velvet, sequin, wool, cashmere, leather, suede, denim, linen, cotton, lace, tweed, faux fur, shearling, metallic'

/** When the brief names no garment, colour, cloth or brand, these are the asks for the occasions she composes for most. */
const OCCASION_ASKS: { test: RegExp; asks: string[]; occasion: string }[] = [
  { test: /new year|nye|party|cocktail|night out|going out|celebrat/i, asks: ['sequin mini dress and heels', 'satin slip dress and heels', 'velvet blazer and black trousers', 'metallic skirt and a black top'], occasion: 'party' },
  { test: /christmas|festive|xmas|december|lunch|dinner|supper/i, asks: ['velvet midi dress', 'knitwear and a midi skirt', 'silk blouse and tailored trousers', 'red dress and heels'], occasion: 'dinner' },
  { test: /wedding|guest|ceremony/i, asks: ['midi dress and heels', 'maxi dress', 'silk skirt and a blouse'], occasion: 'wedding' },
  { test: /work|office|meeting|desk|interview/i, asks: ['blazer and trousers', 'shirt and tailored trousers', 'knitwear and a midi skirt'], occasion: 'work' },
  { test: /weekend|casual|brunch|everyday|school run|errands/i, asks: ['jeans and knitwear', 'trench coat and jeans', 'shirt and jeans'], occasion: 'weekend' },
  { test: /holiday|beach|summer|vacation|resort/i, asks: ['linen trousers and a shirt', 'maxi dress and sandals', 'shorts and a blouse'], occasion: 'holiday' },
  { test: /date|dinner date|evening/i, asks: ['slip dress and heels', 'silk blouse and a midi skirt', 'black dress and heels'], occasion: 'date night' },
]

/**
 * The asks a brief composes from. A brief that already names a piece ("fur
 * coats", "midi skirt with a shirt") is one ask. One that names only an
 * occasion ("New Year's Eve party outfits") is read by Claude into three or
 * four asks in the composer's vocabulary, with the occasion kept for the
 * constitution; without an API, the occasion table above.
 */
export async function expandBrief(brief: string, knownBrands: string[]): Promise<{ asks: string[]; occasion: string | null; notes: string[] }> {
  const text = brief.trim()
  const parses = (s: string) => parseOutfitAsk(s, knownBrands).pieces.length > 0
  if (parses(text)) return { asks: [text], occasion: null, notes: [] }
  const notes: string[] = []
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (apiKey) {
    try {
      const client = new Anthropic({ apiKey })
      const response = await client.messages.create({
        model: 'claude-haiku-5-5',
        max_tokens: 400,
        system: `You turn a fashion content brief into three or four short outfit asks a deterministic composer can read. Each ask names one or two garments from this list — ${TYPE_WORDS} — optionally with a colour or one of these cloths: ${CLOTH_WORDS}. Plain words, no brands, no adjectives the list does not have. Different asks should lead with different garments so the content has range. Reply with JSON only: {"asks": ["…", "…", "…"], "occasion": "two or three words for the occasion, or null"}.`,
        messages: [{ role: 'user', content: `Brief: ${text}` }],
      })
      const raw = response.content.filter((b) => b.type === 'text').map((b: any) => b.text).join('\n')
      const first = raw.indexOf('{'); const last = raw.lastIndexOf('}')
      if (first !== -1 && last > first) {
        const parsed = JSON.parse(raw.slice(first, last + 1))
        const asks = (Array.isArray(parsed.asks) ? parsed.asks : []).filter((a: unknown): a is string => typeof a === 'string' && parses(a)).slice(0, 4)
        if (asks.length) {
          const occasion = typeof parsed.occasion === 'string' && parsed.occasion.trim() ? parsed.occasion.trim().slice(0, 40) : null
          notes.push(`Read “${text}” as: ${asks.join(' · ')}`)
          return { asks, occasion, notes }
        }
      }
      notes.push('Claude could not read the brief into pieces; using MYRA’s own occasion notes')
    } catch (err) {
      console.error('[review-projects] expand brief', err)
      notes.push('Brief reader unavailable; using MYRA’s own occasion notes')
    }
  }
  const table = OCCASION_ASKS.find((o) => o.test.test(text))
  if (table) {
    notes.push(`Read “${text}” as: ${table.asks.join(' · ')}`)
    return { asks: table.asks, occasion: table.occasion, notes }
  }
  return { asks: [], occasion: null, notes: [`Couldn’t find a piece in “${text}” — name a garment, a colour, a cloth, a brand or an occasion`] }
}

// ── Three ways ─────────────────────────────────────────────────────────────

interface Way { label: string; keep: (it: any) => boolean }
const typeOf = (it: any) => String(it.item_type ?? '')
const nameOf = (it: any) => String(it.product_name ?? '').toLowerCase()
const CAMI = /\b(cami|camisole|vest|tank|strappy)\b/

/** The three companions a hero is worn with: the garment that changes the look, everything else free. */
export function waysFor(itemType: string): Way[] {
  const kind = reviewAnchorKind(itemType)
  const topIs = (types: string[], extra?: RegExp) => (it: any) =>
    slotForItemType(it.item_type) !== 'top' || types.includes(typeOf(it)) || (!!extra && extra.test(nameOf(it)))
  const bottomIs = (types: string[]) => (it: any) => {
    const s = slotForItemType(it.item_type)
    if (s === 'dress') return false
    return s !== 'bottom' || types.includes(typeOf(it))
  }
  const shoeIs = (types: string[]) => (it: any) => slotForItemType(it.item_type) !== 'shoe' || types.includes(typeOf(it))
  if (kind === 'bottom') return [
    { label: 'WITH A SHIRT', keep: topIs(['shirt', 'blouse']) },
    { label: 'WITH A KNIT', keep: topIs(['knitwear']) },
    { label: 'WITH A CAMI OR TEE', keep: topIs(['t-shirt', 'bodysuit', 'corset'], CAMI) },
  ]
  if (kind === 'top') return [
    { label: 'WITH TROUSERS', keep: bottomIs(['trousers']) },
    { label: 'WITH JEANS', keep: bottomIs(['jeans']) },
    { label: 'WITH A SKIRT', keep: bottomIs(['skirt']) },
  ]
  if (kind === 'dress') return [
    { label: 'WITH HEELS', keep: shoeIs(['heel', 'sandal']) },
    { label: 'WITH BOOTS', keep: shoeIs(['boot']) },
    { label: 'WITH FLATS', keep: shoeIs(['flat', 'mule', 'sneaker']) },
  ]
  // Outerwear: what it goes over.
  return [
    { label: 'OVER A DRESS', keep: (it) => { const s = slotForItemType(it.item_type); return s !== 'top' && s !== 'bottom' } },
    { label: 'WITH JEANS', keep: bottomIs(['jeans']) },
    { label: 'WITH TAILORING', keep: bottomIs(['trousers']) },
  ]
}

// ── Composing ──────────────────────────────────────────────────────────────

type LookInsert = Omit<ReviewProjectLook, 'look_id' | 'created_at' | 'picked_at' | 'outfit_id' | 'shoot_status' | 'shoot_url' | 'shoot_error' | 'decision'>

function toInsert(project: ReviewProject, index: number, anchor: ProjectAnchor, c: ReviewCandidate, way: string | null): LookInsert {
  return {
    project_id: project.project_id,
    anchor_index: index,
    anchor_item_id: anchor.item_id,
    anchor,
    way_label: way,
    items: c.items,
    score: c.score,
    confidence: c.confidence,
    lane: c.lane,
    reasons: c.reasons ?? [],
    statement: c.statement ?? null,
    echoes: c.echoes ?? [],
  }
}

const asAnchor = (a: any): ProjectAnchor => ({
  item_id: a.item_id, product_name: a.product_name, brand_name: a.brand_name ?? null, image_url: a.image_url,
  item_type: String(a.item_type), price: a.price ?? '', colour_family: a.colour_family ?? null,
  stock_status: a.stock_status ?? null, stock_sizes: a.stock_sizes ?? null,
})

/** The anchors a project works through, chosen from its brief or its piece. */
async function planProject(project: ReviewProject): Promise<{ plan: PlanStep[]; notes: string[]; error?: string }> {
  if (project.kind === 'inspiration') return planInspiration(project)
  if (project.anchor_item_id) {
    const brief = project.brief
    let occasion: string | null = null
    let ask: string | null = null
    if (brief) {
      const library = await getReadyAndLiveItems({ allowStale: true })
      const brands = Array.from(new Set(library.map((i) => i.brand?.name).filter(Boolean) as string[]))
      if (parseOutfitAsk(brief, brands).pieces.length > 0) ask = brief
      else occasion = (await expandBrief(brief, brands)).occasion ?? brief
    }
    return { plan: [{ anchorId: project.anchor_item_id, ask, occasion }], notes: [] }
  }
  const library = await getReadyAndLiveItems({ allowStale: true })
  if (library.length === 0) return { plan: [], notes: [], error: 'The library didn’t load — the database is busy. Try again in a moment' }
  const brands = Array.from(new Set(library.map((i) => i.brand?.name).filter(Boolean) as string[]))
  const { asks, occasion, notes } = await expandBrief(project.brief ?? '', brands)
  if (asks.length === 0) return { plan: [], notes, error: notes[0] ?? 'Nothing to compose' }
  const perAsk = Math.max(1, Math.ceil(project.target_anchors / asks.length))
  const plan: PlanStep[] = []
  const seen = new Set<string>()
  for (const ask of asks) {
    const res = await composeFromAsk(ask, null, { surface: 'review', alternatives: perAsk - 1 })
    if (res.error || !res.anchor) { notes.push(`“${ask}”: ${res.error ?? 'nothing found'}`); continue }
    const ids = [res.anchor.item_id, ...(res.anchorAlternatives ?? []).map((a) => a.item_id)]
    let added = 0
    for (const id of ids) {
      if (seen.has(id)) continue
      seen.add(id); added++
      plan.push({ anchorId: id, ask, occasion })
    }
    notes.push(`“${ask}” → ${added} anchor${added === 1 ? '' : 's'}`)
  }
  if (plan.length === 0) return { plan, notes, error: 'Nothing in the library matches that brief' }
  return { plan: plan.slice(0, project.target_anchors), notes }
}

/**
 * A look project's anchors. Two that sit closest to the picture, its colours
 * named; then the same pieces, cloths and proportions with no colour named,
 * the anchors spread across the colours the library answers in. A tonal
 * picture stays tonal: each of those anchors' other garments are asked for in
 * the anchor's own colour.
 */
async function planInspiration(project: ReviewProject): Promise<{ plan: PlanStep[]; notes: string[]; error?: string }> {
  const insp = project.inspiration
  if (!insp) return { plan: [], notes: [], error: 'The picture this project was built from is missing' }
  const library = await getReadyAndLiveItems({ allowStale: true })
  if (library.length === 0) return { plan: [], notes: [], error: 'The library didn’t load — the database is busy. Try again in a moment' }
  const notes: string[] = []
  if (insp.summary) notes.push(`Read the picture as: ${insp.summary}`)
  const plan: PlanStep[] = []
  const seen = new Set<string>()
  // PIECE BY PIECE (lib/review-inspiration-match): every key piece of the
  // picture matched on its own and checked by eye against the picture. The
  // anchors come in turn from the look's two key garments, so a project built
  // on a jacket-and-skirt picture is anchored on the skirt as often as on the
  // jacket; of each, the one in the picture's colour leads as CLOSEST.
  const matched = await matchInspiration(insp)
  notes.push(...matched.notes)
  const keys = matched.matches
    .filter((m) => m.slot === 'dress' || m.slot === 'top' || m.slot === 'bottom' || m.slot === 'outerwear')
    .sort((a, b) => Number(b.hero) - Number(a.hero))
    .slice(0, 2)
  if (keys.length) {
    insp.matches = matched.matches
    await (createAdminClient() as any).from('review_project').update({ inspiration: insp }).eq('project_id', project.project_id)
    const colourOf = new Map(library.map((i) => [i.item_id, String((i as any).colour_family ?? '').toLowerCase()]))
    const per = Math.ceil(project.target_anchors / keys.length)
    const queues = keys.map((k) => {
      const want = colourFamilyOf(insp.pieces.find((p) => p.slot === k.slot)?.colour)
      const closest = want ? k.picks.find((p) => colourOf.get(p.id) === want) : undefined
      const order = closest ? [closest, ...k.picks.filter((p) => p !== closest)] : k.picks
      return order.slice(0, per).map((p) => ({ anchorId: p.id, ask: null, way: p === closest ? WAY_CLOSE : WAY_STYLE }))
    })
    const plan: PlanStep[] = []
    const taken = new Set<string>()
    for (let i = 0; i < per; i++) for (const q of queues) {
      const step = q[i]
      if (!step || taken.has(step.anchorId) || plan.length >= project.target_anchors) continue
      taken.add(step.anchorId)
      plan.push(step)
    }
    if (plan.length) return { plan, notes }
  }
  // Nothing matched by eye: the first version — anchors for the lead piece, the sentence composer for the rest.
  const anchorsOf = (res: Awaited<ReturnType<typeof composeFromAsk>>) => (res.anchor ? [res.anchor, ...(res.anchorAlternatives ?? [])] : [])
  // The piece the look is built around: the first garment, which the composer leads with too.
  const lead = insp.pieces.find((p) => p.slot === 'dress' || p.slot === 'top' || p.slot === 'bottom' || p.slot === 'outerwear')

  const closeN = Math.min(INSPIRATION_CLOSE_ANCHORS, project.target_anchors)
  if (insp.close_ask && insp.close_ask !== insp.style_ask) {
    const res = await composeFromAsk(insp.close_ask, null, { surface: 'review', alternatives: 400 })
    const close = bySignature(anchorsOf(res), lead).slice(0, closeN)
    for (const a of close) { seen.add(a.item_id); plan.push({ anchorId: a.item_id, ask: insp.close_ask, way: WAY_CLOSE }) }
    notes.push(close.length ? `Closest to the picture — “${insp.close_ask}” → ${close.length} anchor${close.length === 1 ? '' : 's'}` : `Closest to the picture — “${insp.close_ask}”: ${res.error ?? 'nothing found'}`)
  }

  const styleN = Math.max(1, project.target_anchors - plan.length)
  // Every match for the lead piece, the ones that carry its character first
  // (the beaded jacket before the plain cropped one), then the strongest of
  // those spread across colours.
  const res = await composeFromAsk(insp.style_ask, null, { surface: 'review', alternatives: 4000 })
  const strongest = strongestBySignature(anchorsOf(res).filter((a) => !seen.has(a.item_id)), lead, styleN)
  const style = spreadByColour(strongest, styleN)
  for (const a of style) {
    const tonal = insp.palette === 'tonal' ? askForLook(insp.pieces, (a.colour_family ?? '').toLowerCase()) : ''
    plan.push({ anchorId: a.item_id, ask: tonal || insp.style_ask, way: WAY_STYLE })
  }
  notes.push(style.length
    ? `In this style — “${insp.style_ask}”${insp.palette === 'tonal' ? ', each kept tonal in its anchor’s colour' : ''} → ${style.length} anchor${style.length === 1 ? '' : 's'}`
    : `In this style — “${insp.style_ask}”: ${res.error ?? 'nothing found'}`)
  if (plan.length === 0) return { plan, notes, error: 'Nothing in the library is in the style of that picture' }
  return { plan, notes }
}

/** The looks for one planned anchor, the way the Review card would show them. */
async function composeStep(project: ReviewProject, step: PlanStep, index: number, avoid: string[]): Promise<LookInsert[]> {
  if (project.kind === 'inspiration' && project.inspiration?.matches?.length && !step.ask) {
    // Every piece from its own matches, at the anchor's price point.
    const res = await composeInspirationLooks(project.inspiration, step.anchorId, step.way ?? null, avoid, INSPIRATION_LOOKS_PER_ANCHOR)
    if (!res) return []
    return res.candidates.map((c) => toInsert(project, index, asAnchor(res.anchor), c, step.way ?? null))
  }
  if (project.kind === 'inspiration') {
    // Only what the ask builds: the plain recipe around this anchor would not be in the picture's style.
    if (!step.ask) return []
    const res = await composeFromAsk(step.ask, step.anchorId, { surface: 'review', anchorFromAsk: true, avoid })
    if (res.error || !res.anchor) return []
    return (res.candidates ?? []).slice(0, INSPIRATION_LOOKS_PER_ANCHOR).map((c) => toInsert(project, index, asAnchor(res.anchor), c as ReviewCandidate, step.way ?? null))
  }
  if (project.kind === 'three_ways') {
    const anchorRow: any = await getItem(step.anchorId)
    if (!anchorRow) return []
    const out: LookInsert[] = []
    for (const way of waysFor(String(anchorRow.item_type))) {
      const res = await composeForReview(step.anchorId, { libraryFilter: way.keep, count: 2, occasion: step.occasion ?? null })
      if (res.error || !res.anchor) continue
      for (const c of (res.candidates ?? []).slice(0, 2)) out.push(toInsert(project, index, asAnchor(res.anchor), c, way.label))
    }
    return out
  }
  if (step.ask) {
    const res = await composeFromAsk(step.ask, step.anchorId, { surface: 'review', anchorFromAsk: true, avoid })
    if (!res.error && res.anchor && (res.candidates ?? []).length) {
      return (res.candidates ?? []).map((c) => toInsert(project, index, asAnchor(res.anchor), c as ReviewCandidate, null))
    }
    // The ask said more than the anchor can carry ("a shirt" when the anchor is one): the recipe alone.
  }
  const res = await composeForReview(step.anchorId, { occasion: step.occasion ?? null })
  if (res.error || !res.anchor) return []
  return (res.candidates ?? []).map((c) => toInsert(project, index, asAnchor(res.anchor), c, null))
}

/** Pieces already in the project's looks, so the next anchors lean elsewhere (as the Review run does). */
async function avoidListFor(admin: any, projectId: string): Promise<string[]> {
  const { data } = await admin.from('review_project_look').select('items').eq('project_id', projectId)
  const out: string[] = []
  for (const l of (data ?? []) as any[]) for (const it of (Array.isArray(l.items) ? l.items : [])) if (it?.item_id) out.push(String(it.item_id))
  return out
}

/** Compose one project until it is done, paused, deleted, or the budget runs out ('later'). */
async function runProject(admin: any, project: ReviewProject, deadline: number): Promise<'done' | 'later' | 'stopped' | 'failed'> {
  const beat = (patch: Record<string, unknown> = {}) =>
    admin.from('review_project').update({ heartbeat_at: nowIso(), ...patch }).eq('project_id', project.project_id)
  let plan = project.plan
  let notes = project.notes
  if (!plan) {
    const planned = await planProject(project)
    notes = [...notes, ...planned.notes]
    if (planned.error || planned.plan.length === 0) {
      await beat({ status: 'failed', error: planned.error ?? 'Nothing to compose', notes, finished_at: nowIso() })
      return 'failed'
    }
    plan = planned.plan
    await beat({ plan, notes, anchors_total: plan.length, anchors_tried: 0 })
  }
  const avoid = await avoidListFor(admin, project.project_id)
  let tried = project.anchors_tried
  let count = project.looks_count
  for (let i = tried; i < plan.length; i++) {
    // Her say first: paused or deleted while composing stops the run.
    const { data: cur } = await admin.from('review_project').select('status').eq('project_id', project.project_id).maybeSingle()
    if (!cur || cur.status !== 'running') return 'stopped'
    if (Date.now() > deadline - 5_000) {
      await beat({ status: 'queued' })
      return 'later'
    }
    let looks: LookInsert[] = []
    try { looks = await composeStep(project, plan[i], i, avoid) } catch (err) { console.error('[review-projects] compose', project.project_id, i, err) }
    if (looks.length) {
      const { error } = await admin.from('review_project_look').insert(looks)
      if (error) console.error('[review-projects] insert looks', error)
      else { count += looks.length; for (const l of looks) for (const it of l.items) avoid.push(it.item_id) }
    }
    tried = i + 1
    await beat({ anchors_tried: tried, looks_count: count })
  }
  await beat({ status: 'done', finished_at: nowIso(), anchors_tried: tried, looks_count: count, error: count === 0 ? 'No brand-coherent looks for these anchors' : null })
  return 'done'
}

/** One shoot: the picked look's outfit through the Refined · Light Higgsfield set-up, the result kept on the look. */
async function runShoot(admin: any, look: { look_id: string; outfit_id: string }): Promise<void> {
  try {
    const shot = await generateHiggsfieldShootForOutfit(look.outfit_id, 'F6')
    if (shot.imageUrl) {
      await admin.from('review_project_look').update({ shoot_status: 'done', shoot_url: shot.imageUrl, shoot_error: null }).eq('look_id', look.look_id)
      return
    }
    // The fidelity check can refuse a render that is still worth her eye for
    // content: every take is kept on the outfit's additional_images, so the
    // latest one is shown beside the failure for her to judge herself.
    const url = await latestRenderFor(admin, look.outfit_id)
    await admin.from('review_project_look').update({ shoot_status: 'failed', shoot_url: url, shoot_error: (shot.error ?? 'No image came back').slice(0, 300) }).eq('look_id', look.look_id)
  } catch (err) {
    await admin.from('review_project_look').update({ shoot_status: 'failed', shoot_error: (err instanceof Error ? err.message : String(err)).slice(0, 300) }).eq('look_id', look.look_id)
  }
}

/** The most recent Higgsfield take kept on an outfit (generateHiggsfieldShoot appends every one). */
async function latestRenderFor(admin: any, outfitId: string): Promise<string | null> {
  try {
    const { data } = await admin.from('outfit').select('additional_images').eq('outfit_id', outfitId).maybeSingle()
    const imgs: string[] = Array.isArray(data?.additional_images) ? data.additional_images.filter((u: unknown) => typeof u === 'string') : []
    const renders = imgs.filter((u) => /res\.cloudinary\.com/.test(u) && !/outfit-saves\/anchor-/.test(u))
    return renders.length ? renders[renders.length - 1] : null
  } catch { return null }
}

async function recoverStale(admin: any): Promise<number> {
  let n = 0
  const staleAt = new Date(Date.now() - STALE_MS).toISOString()
  const { data: stale } = await admin.from('review_project').select('project_id, attempts, started_at, heartbeat_at').eq('status', 'running')
  for (const p of (stale ?? []) as any[]) {
    const alive = p.heartbeat_at ?? p.started_at
    if (alive && alive > staleAt) continue
    const attempts = (p.attempts ?? 0) + 1
    await admin.from('review_project').update(
      attempts >= MAX_ATTEMPTS
        ? { status: 'failed', attempts, error: 'Stopped three times without finishing', finished_at: nowIso() }
        : { status: 'queued', attempts },
    ).eq('project_id', p.project_id)
    n++
  }
  const shootStale = new Date(Date.now() - SHOOT_STALE_MS).toISOString()
  const { data: shoots } = await admin.from('review_project_look').update({ shoot_status: 'failed', shoot_error: 'The shoot was cut off — shoot again' })
    .eq('shoot_status', 'running').lt('shoot_started_at', shootStale).select('look_id')
  n += (shoots ?? []).length
  return n
}

/**
 * Work the queues for up to `budgetMs`: projects one at a time, shoots one at
 * a time beside them (a shoot is the CLI waiting, not CPU).
 */
export async function drainReviewProjects(budgetMs: number): Promise<{ projects: number; shoots: number; requeued: number; moreQueued: boolean }> {
  const admin = createAdminClient() as any
  const deadline = Date.now() + budgetMs
  const requeued = await recoverStale(admin)
  let projects = 0
  let shoots = 0

  const composeLoop = async () => {
    while (Date.now() < deadline - 10_000) {
      const { data: next } = await admin.from('review_project').select('*').eq('status', 'queued').order('created_at').limit(1)
      const row = next?.[0]
      if (!row) return
      const { data: claimed } = await admin.from('review_project')
        .update({ status: 'running', started_at: row.started_at ?? nowIso(), heartbeat_at: nowIso(), error: null })
        .eq('project_id', row.project_id).eq('status', 'queued').select('*').maybeSingle()
      if (!claimed) continue
      projects++
      const outcome = await runProject(admin, rowToProject(claimed), deadline)
      if (outcome === 'later') return
    }
  }
  const shootLoop = async () => {
    while (Date.now() < deadline - SHOOT_RESERVE_MS) {
      const { data: next } = await admin.from('review_project_look').select('look_id, outfit_id').eq('shoot_status', 'queued').not('outfit_id', 'is', null).order('picked_at').limit(1)
      const row = next?.[0]
      if (!row) return
      const { data: claimed } = await admin.from('review_project_look').update({ shoot_status: 'running', shoot_started_at: nowIso() })
        .eq('look_id', row.look_id).eq('shoot_status', 'queued').select('look_id').maybeSingle()
      if (!claimed) continue
      shoots++
      await runShoot(admin, row)
    }
  }
  await Promise.all([composeLoop(), shootLoop()])

  const [{ count: q }, { count: s }] = await Promise.all([
    admin.from('review_project').select('project_id', { count: 'exact', head: true }).eq('status', 'queued'),
    admin.from('review_project_look').select('look_id', { count: 'exact', head: true }).eq('shoot_status', 'queued'),
  ])
  return { projects, shoots, requeued, moreQueued: (q ?? 0) + (s ?? 0) > 0 }
}

/**
 * Compose ONE held (paused) or queued project in this process, start to
 * finish — for a script that makes projects and wants them composed before it
 * returns, without the drain picking up anything else.
 */
export async function runReviewProjectNow(projectId: string, budgetMs = 20 * 60_000): Promise<'done' | 'later' | 'stopped' | 'failed' | 'missing'> {
  const admin = createAdminClient() as any
  const { data: claimed } = await admin.from('review_project')
    .update({ status: 'running', started_at: nowIso(), heartbeat_at: nowIso(), error: null })
    .eq('project_id', projectId).in('status', ['paused', 'queued']).select('*').maybeSingle()
  if (!claimed) return 'missing'
  return runProject(admin, rowToProject(claimed), Date.now() + budgetMs)
}

/**
 * Start a drain without waiting for it. On Vercel the work goes to the cron
 * function's 300s (the page's own function has 60); locally the promise
 * simply runs in the dev server, for as long as it needs.
 */
export function kickReviewProjectsDrain(): void {
  if (Date.now() - lastKickAt < KICK_THROTTLE_MS) return
  lastKickAt = Date.now()
  const secret = process.env.CRON_SECRET
  if (secret && process.env.VERCEL) {
    const req = fetch(siteUrl('/api/cron/review-projects?kick=1'), { headers: { authorization: `Bearer ${secret}` }, cache: 'no-store' })
      .then((r) => { if (!r.ok) console.error('[review-projects] kick', r.status) })
      .catch((e) => console.error('[review-projects] kick', e))
    try { waitUntil(Promise.race([req, new Promise((r) => setTimeout(r, 3_000))])) } catch { /* local */ }
    return
  }
  const work = drainReviewProjects(45 * 60_000)
    .then((r) => { if (r.moreQueued) { lastKickAt = 0; kickReviewProjectsDrain() } })
    .catch((e) => console.error('[review-projects] drain', e))
  try { waitUntil(work) } catch { /* local dev: the promise simply runs */ }
}
