import Image from 'next/image'
import { createAdminClient } from '@/lib/supabase-server'
import { BRAND_GROUPS, AGE_RANGES } from '@/app/onboarding/brand-groups'

export const dynamic = 'force-dynamic'

interface PrefRow {
  user_id: string
  email: string | null
  age_range: string | null
  brand_groups: string[]
  liked_outfit_ids: string[]
  disliked_outfit_ids: string[]
  created_at: string
}

const GROUP_NAME = new Map(BRAND_GROUPS.map((g) => [g.key, g.name]))

export default async function SignupPreferencesPage() {
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('signup_preference' as any)
    .select('*')
    .order('created_at', { ascending: false })

  const tableReady = !error
  const rows = (tableReady ? (data as unknown as PrefRow[]) : []) ?? []

  // ── Aggregates ──
  const total = rows.length

  const groupCounts = new Map<string, number>()
  const ageCounts = new Map<string, number>()
  const likeCounts = new Map<string, number>()
  const dislikeCounts = new Map<string, number>()

  for (const r of rows) {
    for (const g of r.brand_groups ?? []) groupCounts.set(g, (groupCounts.get(g) ?? 0) + 1)
    if (r.age_range) ageCounts.set(r.age_range, (ageCounts.get(r.age_range) ?? 0) + 1)
    for (const id of r.liked_outfit_ids ?? []) likeCounts.set(id, (likeCounts.get(id) ?? 0) + 1)
    for (const id of r.disliked_outfit_ids ?? []) dislikeCounts.set(id, (dislikeCounts.get(id) ?? 0) + 1)
  }

  const groupRanked = BRAND_GROUPS
    .map((g) => ({ key: g.key, name: g.name, count: groupCounts.get(g.key) ?? 0 }))
    .sort((a, b) => b.count - a.count)
  const maxGroup = Math.max(1, ...groupRanked.map((g) => g.count))

  const ageRanked = AGE_RANGES.map((r) => ({ range: r, count: ageCounts.get(r) ?? 0 }))
  const maxAge = Math.max(1, ...ageRanked.map((a) => a.count))

  // Top liked / disliked outfit images
  const topLikedIds = [...likeCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
  const topDislikedIds = [...dislikeCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
  const allOutfitIds = [...new Set([...topLikedIds, ...topDislikedIds].map(([id]) => id))]

  const outfitImg = new Map<string, { image: string; label: string }>()
  if (tableReady && allOutfitIds.length > 0) {
    const { data: outfitsData } = await admin
      .from('outfit')
      .select('outfit_id, image_url, aesthetic_label')
      .in('outfit_id', allOutfitIds)
    for (const o of (outfitsData ?? []) as any[]) {
      outfitImg.set(o.outfit_id, { image: o.image_url, label: o.aesthetic_label ?? '' })
    }
  }

  // ── Most-clicked items (retailer click-throughs) ──
  let itemClicksReady = true
  const clickCounts = new Map<string, number>()
  {
    const { data: clicks, error: clickErr } = await admin
      .from('item_click' as any)
      .select('item_id')
      .limit(10000)
    if (clickErr) {
      itemClicksReady = false
    } else {
      for (const c of (clicks ?? []) as { item_id: string }[]) {
        clickCounts.set(c.item_id, (clickCounts.get(c.item_id) ?? 0) + 1)
      }
    }
  }

  const topItemEntries = [...clickCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24)
  const topItemMeta = new Map<string, { name: string; brand: string; image: string; url: string; price: string }>()
  if (topItemEntries.length > 0) {
    const { data: itemsData } = await admin
      .from('item')
      .select('item_id, product_name, image_url, retailer_url, price, currency, brand(name)')
      .in('item_id', topItemEntries.map(([id]) => id))
    for (const it of (itemsData ?? []) as any[]) {
      topItemMeta.set(it.item_id, {
        name: it.product_name ?? 'Unknown',
        brand: it.brand?.name ?? '',
        image: it.image_url ?? '',
        url: it.retailer_url ?? '',
        price: it.price ? `${it.price}` : '',
      })
    }
  }
  const totalClicks = [...clickCounts.values()].reduce((s, n) => s + n, 0)

  // ── Most-saved outfits ──
  let savesReady = true
  const saveCounts = new Map<string, number>()
  {
    const { data: saves, error: savesErr } = await admin
      .from('saved_outfit' as any)
      .select('outfit_id')
      .limit(10000)
    if (savesErr) savesReady = false
    else for (const s of (saves ?? []) as { outfit_id: string }[]) saveCounts.set(s.outfit_id, (saveCounts.get(s.outfit_id) ?? 0) + 1)
  }
  const totalSaves = [...saveCounts.values()].reduce((s, n) => s + n, 0)
  const topSavedEntries = [...saveCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
  const savedImg = new Map<string, { image: string; label: string }>()
  if (topSavedEntries.length > 0) {
    const { data: so } = await admin
      .from('outfit')
      .select('outfit_id, image_url, aesthetic_label')
      .in('outfit_id', topSavedEntries.map(([id]) => id))
    for (const o of (so ?? []) as any[]) savedImg.set(o.outfit_id, { image: o.image_url, label: o.aesthetic_label ?? '' })
  }

  const renderOutfitGrid = (entries: [string, number][], tone: 'like' | 'dislike') => (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
      {entries.map(([id, count]) => {
        const o = outfitImg.get(id)
        return (
          <div key={id} className="relative aspect-[3/4] rounded-[12px] overflow-hidden border border-[#E2E0DB] bg-[#FAFAF8]">
            {o?.image && (
              <Image src={o.image} alt={o.label} fill className="object-cover" sizes="120px" />
            )}
            <span
              className={`absolute top-1.5 right-1.5 text-[9px] tracking-[0.045em] px-1.5 py-0.5 rounded-sm text-white ${
                tone === 'like' ? 'bg-[#3A6B3A]' : 'bg-[#B83A3A]'
              }`}
            >
              {count} {tone === 'like' ? '♥' : '✕'}
            </span>
          </div>
        )
      })}
    </div>
  )

  return (
    <div>
      <div className="mb-8">
        <p className="text-[10px] tracking-[0.113em] text-[#6B6B6B] mb-1">ADMIN</p>
        <h1 className="text-[22px] tracking-[0.045em] text-[#4A4E57]">SIGN-UP PREFERENCES</h1>
        <p className="text-[11px] tracking-[0.068em] text-[#A8A8A4] mt-1">
          What new users tell us about their taste at sign-up
        </p>
      </div>

      {!tableReady && (
        <div className="border border-[#E8D9B8] bg-[#FBF6EA] rounded-[12px] p-5 mb-8 max-w-[640px]">
          <p className="text-[11px] tracking-[0.081em] text-[#8A7A4E] mb-3">DATABASE TABLE NOT YET CREATED</p>
          <p className="text-[10px] tracking-[0.054em] text-[#8A7A4E] leading-relaxed mb-3">
            Run migration <span className="font-mono">0006_signup_onboarding.sql</span> in your Supabase SQL Editor
            to start collecting onboarding data:
          </p>
          <pre className="text-[9px] bg-white border border-[#E8D9B8] p-3 rounded overflow-x-auto text-[#6B6B6B] leading-relaxed">{`ALTER TABLE public.outfit
  ADD COLUMN IF NOT EXISTS age_ranges text[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS public.signup_preference (
  user_id             uuid PRIMARY KEY,
  email               text,
  age_range           text,
  brand_groups        text[] NOT NULL DEFAULT '{}',
  liked_outfit_ids    uuid[] NOT NULL DEFAULT '{}',
  disliked_outfit_ids uuid[] NOT NULL DEFAULT '{}',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.signup_preference ENABLE ROW LEVEL SECURITY;`}</pre>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
        {[
          { label: 'USERS ONBOARDED', value: total.toLocaleString() },
          { label: 'TOP BRAND WORLD', value: groupRanked[0]?.count ? GROUP_NAME.get(groupRanked[0].key)?.split(' / ')[0] ?? '—' : '—' },
          { label: 'TOP AGE RANGE', value: [...ageRanked].sort((a, b) => b.count - a.count)[0]?.count ? [...ageRanked].sort((a, b) => b.count - a.count)[0].range : '—' },
          { label: 'OUTFITS RATED', value: ([...likeCounts.values()].reduce((s, n) => s + n, 0) + [...dislikeCounts.values()].reduce((s, n) => s + n, 0)).toLocaleString() },
        ].map((s) => (
          <div key={s.label} className="border border-[#E2E0DB] bg-white rounded-[12px] px-5 py-4">
            <p className="text-[9px] tracking-[0.09em] text-[#A8A8A4] mb-2">{s.label}</p>
            <p className="text-[20px] tracking-[0.018em] text-[#4A4E57] leading-tight">{s.value}</p>
          </div>
        ))}
      </div>

      {total === 0 && tableReady && (
        <p className="text-[11px] tracking-[0.09em] text-[#A8A8A4] py-16 text-center">
          NO SIGN-UP DATA YET — IT APPEARS HERE AS NEW USERS COMPLETE ONBOARDING.
        </p>
      )}

      {total > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Brand group popularity */}
          <div className="border border-[#E2E0DB] bg-white rounded-[12px] p-6">
            <p className="text-[10px] tracking-[0.099em] text-[#6B6B6B] mb-5">BRAND WORLDS · MOST LOVED</p>
            <div className="space-y-3">
              {groupRanked.map((g) => (
                <div key={g.key}>
                  <div className="flex justify-between mb-1">
                    <span className="text-[9px] tracking-[0.054em] text-[#4A4E57]">{g.name.toUpperCase()}</span>
                    <span className="text-[9px] tracking-[0.045em] text-[#6B6B6B]">{g.count}</span>
                  </div>
                  <div className="h-[4px] bg-[#F2F2F2] rounded-full overflow-hidden">
                    <div className="h-full bg-[#0A0A0A] rounded-full" style={{ width: `${(g.count / maxGroup) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Age range breakdown */}
          <div className="border border-[#E2E0DB] bg-white rounded-[12px] p-6">
            <p className="text-[10px] tracking-[0.099em] text-[#6B6B6B] mb-5">AGE RANGES</p>
            <div className="space-y-3">
              {ageRanked.map((a) => (
                <div key={a.range}>
                  <div className="flex justify-between mb-1">
                    <span className="text-[9px] tracking-[0.054em] text-[#4A4E57]">{a.range}</span>
                    <span className="text-[9px] tracking-[0.045em] text-[#6B6B6B]">{a.count}</span>
                  </div>
                  <div className="h-[4px] bg-[#F2F2F2] rounded-full overflow-hidden">
                    <div className="h-full bg-[#C4A882] rounded-full" style={{ width: `${(a.count / maxAge) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Most liked / disliked outfits */}
      {topLikedIds.length > 0 && (
        <div className="border border-[#E2E0DB] bg-white rounded-[12px] p-6 mb-6">
          <p className="text-[10px] tracking-[0.099em] text-[#6B6B6B] mb-5">MOST-LOVED OUTFITS</p>
          {renderOutfitGrid(topLikedIds, 'like')}
        </div>
      )}
      {topDislikedIds.length > 0 && (
        <div className="border border-[#E2E0DB] bg-white rounded-[12px] p-6 mb-8">
          <p className="text-[10px] tracking-[0.099em] text-[#6B6B6B] mb-5">MOST-PASSED OUTFITS</p>
          {renderOutfitGrid(topDislikedIds, 'dislike')}
        </div>
      )}

      {/* ── Most-clicked items (retailer click-throughs) ── */}
      <div className="border border-[#E2E0DB] bg-white rounded-[12px] p-6 mb-8">
        <div className="flex items-baseline justify-between mb-5">
          <p className="text-[10px] tracking-[0.099em] text-[#6B6B6B]">
            MOST-CLICKED ITEMS · SHOP-THROUGHS
          </p>
          {itemClicksReady && (
            <p className="text-[9px] tracking-[0.072em] text-[#A8A8A4]">
              {totalClicks.toLocaleString()} TOTAL CLICK{totalClicks === 1 ? '' : 'S'}
            </p>
          )}
        </div>

        {!itemClicksReady ? (
          <div className="border border-[#E8D9B8] bg-[#FBF6EA] rounded-[12px] p-4">
            <p className="text-[10px] tracking-[0.063em] text-[#8A7A4E] leading-relaxed mb-2">
              Run migration <span className="font-mono">0007_item_click.sql</span> in Supabase to start
              tracking retailer click-throughs:
            </p>
            <pre className="text-[9px] bg-white border border-[#E8D9B8] p-3 rounded overflow-x-auto text-[#6B6B6B] leading-relaxed">{`CREATE TABLE IF NOT EXISTS public.item_click (
  click_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id    uuid NOT NULL,
  outfit_id  uuid,
  clicked_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS item_click_item_id_idx ON public.item_click (item_id);
ALTER TABLE public.item_click ENABLE ROW LEVEL SECURITY;`}</pre>
          </div>
        ) : topItemEntries.length === 0 ? (
          <p className="text-[10px] tracking-[0.081em] text-[#A8A8A4] py-8 text-center">
            NO ITEM CLICKS YET — THEY APPEAR HERE AS USERS CLICK THROUGH TO RETAILERS FROM SOURCE ITEMS.
          </p>
        ) : (
          <div className="space-y-2">
            {topItemEntries.map(([id, count], i) => {
              const m = topItemMeta.get(id)
              return (
                <div
                  key={id}
                  className={`flex items-center gap-3 px-3 py-2 rounded-[12px] ${i % 2 ? 'bg-[#FAFAF8]' : 'bg-white'} border border-[#F2F2F2]`}
                >
                  <span className="text-[10px] tracking-[0.045em] text-[#A8A8A4] w-5 text-right flex-shrink-0">
                    {i + 1}
                  </span>
                  <div className="relative w-[44px] h-[56px] flex-shrink-0 rounded-[10px] overflow-hidden bg-[#F2F2F2]">
                    {m?.image && <Image src={m.image} alt={m.name} fill className="object-cover" sizes="44px" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] tracking-[0.054em] text-[#6B6B6B] truncate">{(m?.brand || '').toUpperCase()}</p>
                    <p className="text-[11px] tracking-[0.027em] text-[#4A4E57] truncate">{m?.name ?? id}</p>
                  </div>
                  {m?.url && (
                    <a
                      href={m.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[9px] tracking-[0.072em] text-[#A8A8A4] hover:text-[#4A4E57] flex-shrink-0"
                    >
                      ↗
                    </a>
                  )}
                  <span className="text-[12px] tracking-[0.027em] text-[#4A4E57] w-12 text-right flex-shrink-0">
                    {count}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Most-saved outfits ── */}
      <div className="border border-[#E2E0DB] bg-white rounded-[12px] p-6 mb-8">
        <div className="flex items-baseline justify-between mb-5">
          <p className="text-[10px] tracking-[0.099em] text-[#6B6B6B]">MOST-SAVED OUTFITS</p>
          {savesReady && (
            <p className="text-[9px] tracking-[0.072em] text-[#A8A8A4]">
              {totalSaves.toLocaleString()} TOTAL SAVE{totalSaves === 1 ? '' : 'S'}
            </p>
          )}
        </div>
        {!savesReady ? (
          <div className="border border-[#E8D9B8] bg-[#FBF6EA] rounded-[12px] p-4">
            <p className="text-[10px] tracking-[0.063em] text-[#8A7A4E] leading-relaxed mb-2">
              Run migration <span className="font-mono">0010_saved_outfit.sql</span> in Supabase to track saves:
            </p>
            <pre className="text-[9px] bg-white border border-[#E8D9B8] p-3 rounded overflow-x-auto text-[#6B6B6B] leading-relaxed">{`CREATE TABLE IF NOT EXISTS public.saved_outfit (
  user_id    uuid NOT NULL,
  outfit_id  uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, outfit_id)
);
CREATE INDEX IF NOT EXISTS saved_outfit_outfit_idx ON public.saved_outfit (outfit_id);
ALTER TABLE public.saved_outfit ENABLE ROW LEVEL SECURITY;`}</pre>
          </div>
        ) : topSavedEntries.length === 0 ? (
          <p className="text-[10px] tracking-[0.081em] text-[#A8A8A4] py-8 text-center">
            NO SAVES YET — THEY APPEAR HERE AS USERS SAVE OUTFITS IN THE EDIT.
          </p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
            {topSavedEntries.map(([id, count]) => {
              const o = savedImg.get(id)
              return (
                <div key={id} className="relative aspect-[3/4] rounded-[12px] overflow-hidden border border-[#E2E0DB] bg-[#FAFAF8]">
                  {o?.image && <Image src={o.image} alt={o.label} fill className="object-cover" sizes="120px" />}
                  <span className="absolute top-1.5 right-1.5 text-[9px] tracking-[0.045em] px-1.5 py-0.5 rounded-sm text-white bg-[#0A0A0A]">
                    {count} ♥
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Per-user table */}
      {total > 0 && (
        <div className="border border-[#E2E0DB] bg-white rounded-[12px] overflow-hidden">
          <div className="grid grid-cols-[1fr_90px_1fr_70px] gap-3 px-5 py-3 border-b border-[#E2E0DB] bg-[#FAFAF8]">
            <span className="text-[9px] tracking-[0.081em] text-[#6B6B6B]">EMAIL</span>
            <span className="text-[9px] tracking-[0.081em] text-[#6B6B6B]">AGE</span>
            <span className="text-[9px] tracking-[0.081em] text-[#6B6B6B]">BRAND WORLDS</span>
            <span className="text-[9px] tracking-[0.081em] text-[#6B6B6B] text-right">RATED</span>
          </div>
          {rows.map((r, i) => (
            <div
              key={r.user_id}
              className={`grid grid-cols-[1fr_90px_1fr_70px] gap-3 px-5 py-3 border-b border-[#E2E0DB] last:border-0 items-center ${i % 2 ? 'bg-[#FAFAF8]' : 'bg-white'}`}
            >
              <span className="text-[11px] tracking-[0.027em] text-[#4A4E57] truncate">{r.email ?? '—'}</span>
              <span className="text-[10px] tracking-[0.045em] text-[#6B6B6B]">{r.age_range ?? '—'}</span>
              <span className="text-[9px] tracking-[0.036em] text-[#6B6B6B] leading-relaxed">
                {(r.brand_groups ?? []).map((g) => GROUP_NAME.get(g)?.split(' / ')[0] ?? g).join(', ') || '—'}
              </span>
              <span className="text-[10px] tracking-[0.045em] text-[#6B6B6B] text-right">
                <span className="text-[#3A6B3A]">{(r.liked_outfit_ids ?? []).length}♥</span>{' '}
                <span className="text-[#B83A3A]">{(r.disliked_outfit_ids ?? []).length}✕</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
