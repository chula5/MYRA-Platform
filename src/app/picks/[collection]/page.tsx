import { notFound } from 'next/navigation'
import { getPickCollectionWithOutfits } from '@/lib/our-picks'
import PicksCollectionClient from './PicksCollectionClient'

export const dynamic = 'force-dynamic'

// Public curated collections. 'bags' is the OUR PICKS headline-bag destination;
// future slugs (shoes, jewellery…) work as soon as the admin curates them.
const TITLES: Record<string, string> = {
  bags: 'Summer Bags',
  shoes: 'The Shoes',
  jewellery: 'The Jewellery',
}

export default async function PicksCollectionPage({
  params,
}: {
  params: Promise<{ collection: string }>
}) {
  const { collection } = await params
  const title = TITLES[collection]
  if (!title) notFound()
  const picks = await getPickCollectionWithOutfits(collection)
  return (
    <div className="min-h-screen bg-[#F2F2F2]">
      <PicksCollectionClient title={title} picks={picks} />
    </div>
  )
}
