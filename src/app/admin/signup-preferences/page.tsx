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

  const renderOutfitGrid = (entries: [string, number][], tone: 'like' | 'dislike') => (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
      {entries.map(([id, count]) => {
        const o = outfitImg.get(id)
        return (
          <div key={id} className="relative aspect-[3/4] rounded-[3px] overflow-hidden border border-[#E2E0DB] bg-[#FAFAF8]">
            {o?.image && (
              <Image src={o.image} alt={o.label} fill className="object-cover" sizes="120px" />
            )}
            <span
              className={`absolute top-1.5 right-1.5 text-[9px] tracking-[0.10em] px-1.5 py-0.5 rounded-sm text-white ${
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
        <p className="text-[10px] tracking-[0.25em] text-[#6B6B6B] mb-1">ADMIN</p>
        <h1 className="text-[22px] tracking-[0.10em] text-[#0A0A0A]">SIGN-UP PREFERENCES</h1>
        <p className="text-[11px] tracking-[0.15em] text-[#A8A8A4] mt-1">
          What new users tell us about their taste at sign-up
        </p>
      </div>

      {!tableReady && (
        <div className="border border-[#E8D9B8] bg-[#FBF6EA] rounded-[3px] p-5 mb-8 max-w-[640px]">
          <p className="text-[11px] tracking-[0.18em] text-[#8A7A4E] mb-3">DATABASE TABLE NOT YET CREATED</p>
          <p className="text-[10px] tracking-[0.12em] text-[#8A7A4E] leading-relaxed mb-3">
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
          <div key={s.label} className="border border-[#E2E0DB] bg-white rounded-[3px] px-5 py-4">
            <p className="text-[9px] tracking-[0.20em] text-[#A8A8A4] mb-2">{s.label}</p>
            <p className="text-[20px] tracking-[0.04em] text-[#0A0A0A] leading-tight">{s.value}</p>
          </div>
        ))}
      </div>

      {total === 0 && tableReady && (
        <p className="text-[11px] tracking-[0.20em] text-[#A8A8A4] py-16 text-center">
          NO SIGN-UP DATA YET — IT APPEARS HERE AS NEW USERS COMPLETE ONBOARDING.
        </p>
      )}

      {total > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Brand group popularity */}
          <div className="border border-[#E2E0DB] bg-white rounded-[3px] p-6">
            <p className="text-[10px] tracking-[0.22em] text-[#6B6B6B] mb-5">BRAND WORLDS · MOST LOVED</p>
            <div className="space-y-3">
              {groupRanked.map((g) => (
                <div key={g.key}>
                  <div className="flex justify-between mb-1">
                    <span className="text-[9px] tracking-[0.12em] text-[#0A0A0A]">{g.name.toUpperCase()}</span>
                    <span className="text-[9px] tracking-[0.10em] text-[#6B6B6B]">{g.count}</span>
                  </div>
                  <div className="h-[4px] bg-[#F2F2F2] rounded-full overflow-hidden">
                    <div className="h-full bg-[#0A0A0A] rounded-full" style={{ width: `${(g.count / maxGroup) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Age range breakdown */}
          <div className="border border-[#E2E0DB] bg-white rounded-[3px] p-6">
            <p className="text-[10px] tracking-[0.22em] text-[#6B6B6B] mb-5">AGE RANGES</p>
            <div className="space-y-3">
              {ageRanked.map((a) => (
                <div key={a.range}>
                  <div className="flex justify-between mb-1">
                    <span className="text-[9px] tracking-[0.12em] text-[#0A0A0A]">{a.range}</span>
                    <span className="text-[9px] tracking-[0.10em] text-[#6B6B6B]">{a.count}</span>
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
        <div className="border border-[#E2E0DB] bg-white rounded-[3px] p-6 mb-6">
          <p className="text-[10px] tracking-[0.22em] text-[#6B6B6B] mb-5">MOST-LOVED OUTFITS</p>
          {renderOutfitGrid(topLikedIds, 'like')}
        </div>
      )}
      {topDislikedIds.length > 0 && (
        <div className="border border-[#E2E0DB] bg-white rounded-[3px] p-6 mb-8">
          <p className="text-[10px] tracking-[0.22em] text-[#6B6B6B] mb-5">MOST-PASSED OUTFITS</p>
          {renderOutfitGrid(topDislikedIds, 'dislike')}
        </div>
      )}

      {/* Per-user table */}
      {total > 0 && (
        <div className="border border-[#E2E0DB] bg-white rounded-[3px] overflow-hidden">
          <div className="grid grid-cols-[1fr_90px_1fr_70px] gap-3 px-5 py-3 border-b border-[#E2E0DB] bg-[#FAFAF8]">
            <span className="text-[9px] tracking-[0.18em] text-[#6B6B6B]">EMAIL</span>
            <span className="text-[9px] tracking-[0.18em] text-[#6B6B6B]">AGE</span>
            <span className="text-[9px] tracking-[0.18em] text-[#6B6B6B]">BRAND WORLDS</span>
            <span className="text-[9px] tracking-[0.18em] text-[#6B6B6B] text-right">RATED</span>
          </div>
          {rows.map((r, i) => (
            <div
              key={r.user_id}
              className={`grid grid-cols-[1fr_90px_1fr_70px] gap-3 px-5 py-3 border-b border-[#E2E0DB] last:border-0 items-center ${i % 2 ? 'bg-[#FAFAF8]' : 'bg-white'}`}
            >
              <span className="text-[11px] tracking-[0.06em] text-[#0A0A0A] truncate">{r.email ?? '—'}</span>
              <span className="text-[10px] tracking-[0.10em] text-[#6B6B6B]">{r.age_range ?? '—'}</span>
              <span className="text-[9px] tracking-[0.08em] text-[#6B6B6B] leading-relaxed">
                {(r.brand_groups ?? []).map((g) => GROUP_NAME.get(g)?.split(' / ')[0] ?? g).join(', ') || '—'}
              </span>
              <span className="text-[10px] tracking-[0.10em] text-[#6B6B6B] text-right">
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
