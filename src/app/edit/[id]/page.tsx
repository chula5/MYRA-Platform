import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase-server'
import { getOutfit } from '@/lib/admin-queries'
import OutfitDetailClient from '@/app/outfit/[id]/OutfitDetailClient'
import { earlyAccessSignOut } from '@/app/earlyaccess/actions'
import { getSavedOutfitIds, getSavedItemIds } from '../save-actions'
import { loadUserSizeProfile } from '@/lib/size-availability'
import { maskOutfitsForShopper, serialiseVerdicts } from '@/lib/outfit-size'
import { rescuesForUser } from '@/lib/rescue'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ styleItem?: string; itemType?: string; mode?: string }>
}

export default async function EditDetailPage({ params, searchParams }: PageProps) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/signin')

  const { id } = await params
  const { styleItem, itemType, mode } = await searchParams

  // Service-role read so the outfit's items are visible (RLS hides draft items).
  const outfit = await getOutfit(id)
  const [savedIds, savedItemIds, sizeCtx] = await Promise.all([
    getSavedOutfitIds(),
    getSavedItemIds(),
    loadUserSizeProfile(user.id),
  ])

  // Her size verdicts for this look, and — if a one-of-one in it has sold —
  // the rescue, so the sourcing panel can strike that piece through and offer
  // "find me something similar" while everything else stays shoppable.
  const sizeInfo = outfit
    ? serialiseVerdicts((await maskOutfitsForShopper([outfit], sizeCtx, user.id)).verdicts)[id] ?? null
    : null
  const rescue = outfit ? (await rescuesForUser(user.id, [id], sizeCtx)).get(id) ?? null : null

  return (
    <div className="min-h-screen bg-[#F2F2F2]">
      <header className="flex items-center justify-between px-8 h-14 border-b border-[#E2E0DB] bg-white">
        <div className="flex items-center gap-3">
          <Link href="/edit" aria-label="MYRA" className="block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/myra-logo-black.png" alt="MYRA" className="h-[18px] w-auto" />
          </Link>
          <span
            className="text-[8px] sm:text-[9px] tracking-[0.22em] text-[#4A4E57] px-2.5 py-1 rounded-full"
            style={{
              background: 'linear-gradient(135deg, #f7f8f9 0%, #e6e8ec 45%, #fcfcfd 62%, #e1e4e9 100%)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.95), inset 0 -1px 2px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.12)',
            }}
          >
            BETA
          </span>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/edit" className="text-[10px] tracking-[0.09em] text-[#6B6B6B] hover:text-[#4A4E57] transition-colors">← THE EDIT</Link>
          <form action={earlyAccessSignOut}>
            <button
              type="submit"
              className="text-[9px] tracking-[0.09em] text-[#6B6B6B] hover:text-[#4A4E57] border border-[#E2E0DB] hover:border-[#0A0A0A] px-3 py-1.5 rounded-full transition-colors duration-300"
            >
              SIGN OUT
            </button>
          </form>
        </div>
      </header>

      {!outfit ? (
        <p className="text-[11px] tracking-[0.113em] text-[#A8A8A4] py-24 text-center">OUTFIT NOT FOUND</p>
      ) : (
        <OutfitDetailClient
          outfitId={id}
          initialOutfit={outfit}
          showBrowseButtons
          linkBase="/edit"
          styleItemId={styleItem}
          itemType={itemType}
          mode={mode as 'similar' | 'explore' | undefined}
          canSave
          initialSaved={savedIds.includes(id)}
          savedItemIds={savedItemIds}
          sizeInfo={sizeInfo ?? undefined}
          soldItemId={rescue?.sold_item_id ?? null}
          rescueId={rescue?.rescue_id ?? null}
        />
      )}
    </div>
  )
}
