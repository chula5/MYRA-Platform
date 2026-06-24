import { getItem, getReadyAndLiveItems, getAllBrands } from '@/lib/admin-queries'
import ComposerClient from './ComposerClient'

interface PageProps {
  searchParams: Promise<{ anchor?: string }>
}

export default async function ComposerPage({ searchParams }: PageProps) {
  const { anchor: anchorId } = await searchParams

  const [initialAnchor, library, allBrands] = await Promise.all([
    anchorId ? getItem(anchorId) : Promise.resolve(null),
    getReadyAndLiveItems(),
    getAllBrands(),
  ])

  // Only brands that actually have a composable item, so the filter has no dead options.
  const brandIdsWithItems = new Set(library.map((i) => i.brand_id).filter(Boolean))
  const brands = allBrands
    .filter((b) => brandIdsWithItems.has(b.brand_id))
    .map((b) => ({ brand_id: b.brand_id, name: b.name }))

  const initialItems = library.map((i) => ({
    item_id: i.item_id,
    product_name: i.product_name,
    image_url: i.image_url,
    item_type: i.item_type,
    brand_name: i.brand?.name ?? null,
  }))

  return (
    <div>
      <div className="mb-10">
        <p className="text-[11px] tracking-[0.25em] text-[#6B6B6B] mb-2">ADMIN STUDIO</p>
        <h1 className="text-[28px] tracking-[0.10em] text-[#4A4E57] mb-3">OUTFIT COMPOSER</h1>
        <p className="text-[12px] tracking-[0.10em] text-[#6B6B6B] max-w-2xl leading-relaxed">
          PICK AN ANCHOR ITEM. THE COMPOSER WILL RETURN OUTFIT COMPOSITIONS BUILT
          FROM YOUR EXISTING LIBRARY, RANKED BY COMPOSITIONAL COHERENCE. APPROVE
          THE ONES YOU LIKE — THEY DROP INTO A &quot;COMPOSER DRAFTS&quot; PROJECT
          AS PRE-SCORED OUTFIT RECORDS.
        </p>
      </div>

      <ComposerClient
        initialAnchorId={initialAnchor?.item_id ?? null}
        initialAnchor={
          initialAnchor
            ? {
                item_id: initialAnchor.item_id,
                product_name: initialAnchor.product_name,
                image_url: initialAnchor.image_url,
                item_type: initialAnchor.item_type,
                brand_name: initialAnchor.brand?.name ?? null,
              }
            : null
        }
        initialItems={initialItems}
        libraryCount={library.length}
        brands={brands}
      />
    </div>
  )
}
