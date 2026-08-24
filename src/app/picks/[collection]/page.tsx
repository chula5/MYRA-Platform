import { notFound } from 'next/navigation'
import { getPickCollectionWithOutfits, getOutfitCollection } from '@/lib/our-picks'
import { pickCollection } from '@/lib/pick-collections'
import PicksCollectionClient from './PicksCollectionClient'
import PicksOutfitsClient from './PicksOutfitsClient'

export const dynamic = 'force-dynamic'

// Titles and kind come from the shared collection config, so a new collection
// is one edit in lib/pick-collections.ts plus curating it in the studio.

export default async function PicksCollectionPage({
  params,
}: {
  params: Promise<{ collection: string }>
}) {
  const { collection } = await params
  const config = pickCollection(collection)
  if (!config) notFound()

  // Outfit collections show complete looks; item collections show shoppable
  // pieces with the looks they appear in.
  if (config.kind === 'outfit') {
    const outfits = await getOutfitCollection(collection)
    return (
      <div className="min-h-screen bg-[#F2F2F2]">
        <PicksOutfitsClient title={config.title} outfits={outfits} />
      </div>
    )
  }

  const picks = await getPickCollectionWithOutfits(collection)
  return (
    <div className="min-h-screen bg-[#F2F2F2]">
      <PicksCollectionClient title={config.title} picks={picks} />
    </div>
  )
}
