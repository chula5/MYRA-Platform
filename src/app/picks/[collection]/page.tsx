import { notFound } from 'next/navigation'
import { getPickCollectionWithOutfits } from '@/lib/our-picks'
import { pickCollection } from '@/lib/pick-collections'
import PicksCollectionClient from './PicksCollectionClient'

export const dynamic = 'force-dynamic'

// Titles come from the shared collection config, so a new collection is one
// edit in lib/pick-collections.ts plus curating it in the studio.

export default async function PicksCollectionPage({
  params,
}: {
  params: Promise<{ collection: string }>
}) {
  const { collection } = await params
  const title = pickCollection(collection)?.title
  if (!title) notFound()
  const picks = await getPickCollectionWithOutfits(collection)
  return (
    <div className="min-h-screen bg-[#F2F2F2]">
      <PicksCollectionClient title={title} picks={picks} />
    </div>
  )
}
