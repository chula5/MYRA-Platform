// Per-account activity: what each signed-up person saved, liked and clicked
// through to a retailer.
//
// WHAT IS AND ISN'T ATTRIBUTABLE — worth being precise about, because a zero
// here can mean two very different things:
//   · saves (outfits + items)  — always carry user_id. Complete.
//   · onboarding likes/dislikes — captured once at sign-up. Complete.
//   · retailer click-throughs   — carry user_id only from migration 0025 onward,
//     and only for signed-IN clicks. Clicks logged before that, and every click
//     by a logged-out visitor, stay anonymous. They are counted in the totals
//     but cannot be pinned to a person, and are never guessed at.
//
// Volumes here are small (tens to low hundreds of rows), so everything is
// fetched once and joined in memory rather than issuing a query per person.

import { createAdminClient } from '@/lib/supabase-server'
import { dayBuckets, type Bucket } from '@/lib/metrics-core'

export interface Ref {
  id: string
  label: string
  image: string | null
  at?: string | null
}

export interface PersonActivity {
  userId: string
  email: string
  createdAt: string
  ageRange: string | null
  brandGroups: string[]
  savedOutfits: Ref[]
  savedItems: Ref[]
  likedOutfits: Ref[]
  dislikedOutfits: Ref[]
  /** Retailer click-throughs, most recent first. */
  clicks: Ref[]
  lastActiveAt: string | null
  totals: { saves: number; likes: number; clicks: number }
}

/**
 * A browser that clicked through without an account. Grouped by the persistent
 * visitor id, so a run of clicks reads as one person's browsing rather than N
 * disconnected events. Never named — there is nothing to name it with.
 */
export interface AnonymousVisitor {
  visitorId: string
  clicks: Ref[]
  firstSeen: string
  lastSeen: string
}

export interface PeopleActivity {
  people: PersonActivity[]
  anonymous: {
    visitors: AnonymousVisitor[]
    /** Clicks from a browser we can group but not name. */
    identifiedBrowsers: number
    /** Clicks with no visitor id either — logged before 0026, or storage blocked. */
    untraceableClicks: number
  }
  totals: {
    accounts: number
    savers: number
    clickers: number
    savedOutfits: number
    savedItems: number
    clicks: number
    /** Clicks with no account attached — logged-out or pre-attribution. */
    anonymousClicks: number
  }
  /** Total retailer click-throughs per day, split by whether we know who. */
  daily: { label: string; date: string; total: number; attributed: number }[]
  /** False until migration 0025 has been run. */
  attributionReady: boolean
}

const DAYS = 30

async function labelMap(
  table: 'item' | 'outfit',
  ids: string[],
): Promise<Map<string, { label: string; image: string | null }>> {
  const out = new Map<string, { label: string; image: string | null }>()
  const clean = Array.from(new Set(ids)).filter(Boolean)
  if (!clean.length) return out
  const admin = createAdminClient()
  try {
    if (table === 'item') {
      const { data } = await admin
        .from('item' as any)
        .select('item_id, product_name, image_url, brand(name)')
        .in('item_id', clean)
      for (const r of (data ?? []) as any[]) {
        out.set(r.item_id, {
          label: [r.brand?.name, r.product_name].filter(Boolean).join(' — ') || 'ITEM',
          image: r.image_url ?? null,
        })
      }
    } else {
      const { data } = await admin
        .from('outfit' as any)
        .select('outfit_id, aesthetic_label, image_url, occasion_tags')
        .in('outfit_id', clean)
      for (const r of (data ?? []) as any[]) {
        out.set(r.outfit_id, {
          label: String(r.aesthetic_label || r.occasion_tags?.[0] || 'OUTFIT'),
          image: r.image_url ?? null,
        })
      }
    }
  } catch {
    /* labels are a nicety — ids still render */
  }
  return out
}

export async function getPeopleActivity(): Promise<PeopleActivity> {
  const admin = createAdminClient()
  const buckets: Bucket[] = dayBuckets(DAYS)

  // ── Accounts ──────────────────────────────────────────────────────────────
  const accounts: { id: string; email: string; created_at: string }[] = []
  try {
    for (let page = 1; page <= 10; page++) {
      const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 })
      const users = data?.users ?? []
      accounts.push(
        ...users.map((u) => ({
          id: u.id,
          email: (u.email as string) ?? '(no email)',
          created_at: u.created_at as string,
        })),
      )
      if (users.length < 200) break
    }
  } catch {
    /* listUsers unavailable in this environment */
  }

  // ── Activity tables ───────────────────────────────────────────────────────
  const safe = async <T,>(fn: () => PromiseLike<{ data: T[] | null; error: any }>): Promise<{ rows: T[]; ok: boolean }> => {
    try {
      const { data, error } = await fn()
      if (error) return { rows: [], ok: false }
      return { rows: (data ?? []) as T[], ok: true }
    } catch {
      return { rows: [], ok: false }
    }
  }

  const [savedOutfits, savedItems, prefs, clicksRes] = await Promise.all([
    safe<{ user_id: string; outfit_id: string; created_at: string }>(() =>
      admin.from('saved_outfit' as any).select('user_id, outfit_id, created_at').limit(5000),
    ),
    safe<{ user_id: string; item_id: string; created_at: string }>(() =>
      admin.from('saved_item' as any).select('user_id, item_id, created_at').limit(5000),
    ),
    safe<{ user_id: string; age_range: string | null; brand_groups: string[]; liked_outfit_ids: string[]; disliked_outfit_ids: string[] }>(() =>
      admin
        .from('signup_preference' as any)
        .select('user_id, age_range, brand_groups, liked_outfit_ids, disliked_outfit_ids')
        .limit(2000),
    ),
    safe<{ item_id: string; clicked_at: string; user_id: string | null; visitor_id: string | null }>(() =>
      admin.from('item_click' as any).select('item_id, clicked_at, user_id, visitor_id').limit(50000),
    ),
  ])

  // A select naming user_id fails outright when the column isn't there, which is
  // exactly how we detect that migration 0025 hasn't been run.
  const attributionReady = clicksRes.ok
  const clicks = clicksRes.rows
  const clicksFallback = attributionReady
    ? { rows: [] as { item_id: string; clicked_at: string }[] }
    : await safe<{ item_id: string; clicked_at: string }>(() =>
        admin.from('item_click' as any).select('item_id, clicked_at').limit(50000),
      )
  const allClicks: {
    item_id: string
    clicked_at: string
    user_id: string | null
    visitor_id: string | null
  }[] = attributionReady ? clicks : clicksFallback.rows.map((r) => ({ ...r, user_id: null, visitor_id: null }))

  // ── Labels ────────────────────────────────────────────────────────────────
  const outfitIds = [
    ...savedOutfits.rows.map((r) => r.outfit_id),
    ...prefs.rows.flatMap((p) => [...(p.liked_outfit_ids ?? []), ...(p.disliked_outfit_ids ?? [])]),
  ]
  const itemIds = [...savedItems.rows.map((r) => r.item_id), ...allClicks.map((r) => r.item_id)]
  const [outfitLabels, itemLabels] = await Promise.all([labelMap('outfit', outfitIds), labelMap('item', itemIds)])

  const outfitRef = (id: string, at?: string | null): Ref => ({
    id,
    label: (outfitLabels.get(id)?.label ?? 'OUTFIT').toUpperCase(),
    image: outfitLabels.get(id)?.image ?? null,
    at: at ?? null,
  })
  const itemRef = (id: string, at?: string | null): Ref => ({
    id,
    label: (itemLabels.get(id)?.label ?? 'ITEM').toUpperCase(),
    image: itemLabels.get(id)?.image ?? null,
    at: at ?? null,
  })

  // ── Per person ────────────────────────────────────────────────────────────
  const prefByUser = new Map(prefs.rows.map((p) => [p.user_id, p]))

  const people: PersonActivity[] = accounts.map((a) => {
    const pref = prefByUser.get(a.id)
    const so = savedOutfits.rows.filter((r) => r.user_id === a.id)
    const si = savedItems.rows.filter((r) => r.user_id === a.id)
    const cl = allClicks
      .filter((r) => r.user_id === a.id)
      .sort((x, y) => new Date(y.clicked_at).getTime() - new Date(x.clicked_at).getTime())

    const stamps = [
      ...so.map((r) => r.created_at),
      ...si.map((r) => r.created_at),
      ...cl.map((r) => r.clicked_at),
    ].filter(Boolean)
    const lastActiveAt = stamps.length
      ? stamps.reduce((latest, s) => (new Date(s) > new Date(latest) ? s : latest))
      : null

    const likedOutfits = (pref?.liked_outfit_ids ?? []).map((id) => outfitRef(id))
    const dislikedOutfits = (pref?.disliked_outfit_ids ?? []).map((id) => outfitRef(id))

    return {
      userId: a.id,
      email: a.email,
      createdAt: a.created_at,
      ageRange: pref?.age_range ?? null,
      brandGroups: pref?.brand_groups ?? [],
      savedOutfits: so.map((r) => outfitRef(r.outfit_id, r.created_at)),
      savedItems: si.map((r) => itemRef(r.item_id, r.created_at)),
      likedOutfits,
      dislikedOutfits,
      clicks: cl.map((r) => itemRef(r.item_id, r.clicked_at)),
      lastActiveAt,
      totals: {
        saves: so.length + si.length,
        likes: likedOutfits.length,
        clicks: cl.length,
      },
    }
  })

  // Most engaged first — the people worth actually looking at.
  people.sort(
    (a, b) =>
      b.totals.clicks + b.totals.saves - (a.totals.clicks + a.totals.saves) ||
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )

  // ── Daily click-throughs ──────────────────────────────────────────────────
  const daily = buckets.map((b) => {
    const inDay = allClicks.filter((c) => {
      const t = new Date(c.clicked_at).getTime()
      return t >= b.start.getTime() && t < b.end.getTime()
    })
    return {
      label: b.label,
      date: b.key,
      total: inDay.length,
      attributed: inDay.filter((c) => c.user_id).length,
    }
  })

  // ── Anonymous browsing ────────────────────────────────────────────────────
  // Clicks with no account, grouped by browser. One visitor clicking five items
  // is one person shopping, not five stray events — that shape is the point.
  const byVisitor = new Map<string, typeof allClicks>()
  let untraceableClicks = 0
  for (const c of allClicks) {
    if (c.user_id) continue
    if (!c.visitor_id) {
      untraceableClicks++
      continue
    }
    const list = byVisitor.get(c.visitor_id) ?? []
    list.push(c)
    byVisitor.set(c.visitor_id, list)
  }

  const visitors: AnonymousVisitor[] = Array.from(byVisitor.entries())
    .map(([visitorId, cs]) => {
      const sorted = [...cs].sort(
        (a, b) => new Date(b.clicked_at).getTime() - new Date(a.clicked_at).getTime(),
      )
      return {
        visitorId,
        clicks: sorted.map((c) => itemRef(c.item_id, c.clicked_at)),
        firstSeen: sorted[sorted.length - 1].clicked_at,
        lastSeen: sorted[0].clicked_at,
      }
    })
    .sort((a, b) => b.clicks.length - a.clicks.length)
    .slice(0, 25)

  return {
    people,
    anonymous: {
      visitors,
      identifiedBrowsers: byVisitor.size,
      untraceableClicks,
    },
    totals: {
      accounts: accounts.length,
      savers: people.filter((p) => p.totals.saves > 0).length,
      clickers: people.filter((p) => p.totals.clicks > 0).length,
      savedOutfits: savedOutfits.rows.length,
      savedItems: savedItems.rows.length,
      clicks: allClicks.length,
      anonymousClicks: allClicks.filter((c) => !c.user_id).length,
    },
    daily,
    attributionReady,
  }
}
