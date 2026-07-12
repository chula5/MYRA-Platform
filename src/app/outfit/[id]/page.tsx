import Navigation from '@/components/navigation/Navigation'
import { getOutfit } from '@/lib/admin-queries'
import OutfitDetailClient from './OutfitDetailClient'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ styleItem?: string; itemType?: string; mode?: string }>
}

export default async function OutfitDetailPage({ params, searchParams }: PageProps) {
  const { id } = await params
  const { styleItem, itemType, mode } = await searchParams

  // Service-role read so all of the outfit's items (and hotspots) show, even
  // when an item's status would hide it from anonymous RLS.
  const outfit = await getOutfit(id)

  return (
    <>
      <Navigation />
      <main className="pt-16 min-h-screen bg-white">
        {!outfit ? (
          <p className="text-[11px] tracking-[0.113em] text-[#A8A8A4] py-24 text-center">OUTFIT NOT FOUND</p>
        ) : (
          <OutfitDetailClient
            outfitId={id}
            initialOutfit={outfit}
            showBrowseButtons
            styleItemId={styleItem}
            itemType={itemType}
            mode={mode as 'similar' | 'explore' | undefined}
          />
        )}
      </main>
    </>
  )
}
