import Link from 'next/link'
import { getOutfit } from '@/lib/admin-queries'
import OutfitDetailClient from '@/app/outfit/[id]/OutfitDetailClient'
import TheEditTagEditor from './TheEditTagEditor'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ styleItem?: string; itemType?: string; mode?: string }>
}

export default async function TheEditPreviewDetailPage({ params, searchParams }: PageProps) {
  const { id } = await params
  const { styleItem, itemType, mode } = await searchParams

  // Admin client → reads the outfit WITH all its items, regardless of item status
  // (the browser client would have these hidden by row-level security).
  const outfit = await getOutfit(id)

  return (
    <div>
      <Link
        href="/admin/the-edit"
        className="text-[10px] tracking-[0.20em] text-[#6B6B6B] hover:text-[#0A0A0A] transition-colors duration-300 mb-6 inline-block"
      >
        ← THE EDIT PREVIEW
      </Link>

      {!outfit ? (
        <p className="text-[11px] tracking-[0.25em] text-[#A8A8A4] py-24 text-center">OUTFIT NOT FOUND</p>
      ) : (
        <div className="bg-white border border-[#E2E0DB] rounded-[3px] overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b border-[#E2E0DB] bg-[#FAFAF8]">
            <span className="text-[9px] tracking-[0.20em] text-[#6B6B6B]">PREVIEW · OUTFIT DETAIL</span>
            <span className="text-[9px] tracking-[0.18em] text-[#A8A8A4]">
              STYLE · SIMILAR · EXPLORE ALL ENABLED
            </span>
          </div>

          {/* Amend which occasions this outfit shows under in The Edit */}
          <TheEditTagEditor outfitId={id} initialTags={outfit.occasion_tags ?? []} />

          <OutfitDetailClient
            outfitId={id}
            initialOutfit={outfit}
            showBrowseButtons
            linkBase="/admin/the-edit"
            styleItemId={styleItem}
            itemType={itemType}
            mode={mode as 'similar' | 'explore' | undefined}
          />
        </div>
      )}
    </div>
  )
}
