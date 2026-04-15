import { Suspense } from 'react'
import Navigation from '@/components/navigation/Navigation'
import OutfitDetailClient from './OutfitDetailClient'

interface PageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ styleItem?: string; itemType?: string; mode?: string }>
}

export default async function OutfitDetailPage({ params, searchParams }: PageProps) {
  const { id } = await params
  const { styleItem, itemType, mode } = await searchParams

  return (
    <>
      <Navigation />
      <main className="pt-16 min-h-screen bg-white">
        <Suspense fallback={<DetailSkeleton />}>
          <OutfitDetailClient
            outfitId={id}
            styleItemId={styleItem}
            itemType={itemType}
            mode={mode as 'similar' | 'explore' | undefined}
          />
        </Suspense>
      </main>
    </>
  )
}

function DetailSkeleton() {
  return (
    <div className="max-w-[800px] mx-auto px-10 py-12">
      <div className="aspect-[3/4] bg-[#F2F2F2] animate-pulse rounded-[2px]" />
    </div>
  )
}
