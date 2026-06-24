import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getItem, getAllBrands, getOutfitsForItem, getReadyAndLiveItems } from '@/lib/admin-queries'
import ItemForm from '@/components/admin/ItemForm'
import { updateItem, updateItemStatus } from '@/app/admin/items/actions'
import StatusBadge from '@/components/admin/StatusBadge'
import { countYield } from '@/lib/composer'
import DeleteItemButton from './DeleteItemButton'

// Brand list and yield count must always be fresh — both depend on rows added
// in other admin flows (Batch Ingest, createBrand, marking items ready).
export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function EditItemPage({ params }: PageProps) {
  const { id } = await params
  const [item, brands, linkedOutfits, library] = await Promise.all([
    getItem(id),
    getAllBrands(),
    getOutfitsForItem(id),
    getReadyAndLiveItems(),
  ])

  if (!item) {
    notFound()
  }

  // Yield = how many compositionally coherent outfits this item could anchor
  // against the current composable library. Drafts now compose too, so we only
  // skip the calculation for archived items.
  const yieldCount = item.status === 'archived' ? null : countYield(item, library)

  async function handleUpdate(formData: FormData) {
    'use server'
    return updateItem(id, formData)
  }

  const nextStatus = {
    draft: 'ready' as const,
    ready: 'live' as const,
    live: 'archived' as const,
    archived: null,
  }[item.status]

  const nextStatusLabel = {
    draft: 'MARK AS READY',
    ready: 'MARK AS LIVE',
    live: 'ARCHIVE',
    archived: null,
  }[item.status]

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <Link
          href="/admin/items"
          className="text-[10px] tracking-[0.20em] text-[#6B6B6B] hover:text-[#4A4E57] transition-colors duration-300 mb-4 inline-block"
        >
          ← ITEM LIBRARY
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[11px] tracking-[0.25em] text-[#6B6B6B] mb-2">EDIT ITEM</p>
            <h1 className="text-[28px] tracking-[0.10em] text-[#4A4E57]">
              {item.product_name.toUpperCase()}
            </h1>
          </div>
          <div className="flex items-center gap-3 mt-2">
            <StatusBadge status={item.status} />
            {nextStatus && nextStatusLabel && (
              <form
                action={async () => {
                  'use server'
                  await updateItemStatus(id, nextStatus)
                }}
              >
                <button
                  type="submit"
                  className="border border-[#0A0A0A] bg-transparent text-[#4A4E57] px-6 py-2.5 text-[10px] tracking-[0.20em] hover:bg-[#0A0A0A] hover:text-white transition-colors duration-400"
                >
                  {nextStatusLabel}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>

      <div className="flex gap-10 items-start">
        <div className="flex-1 min-w-0">
          <ItemForm item={item} brands={brands} action={handleUpdate} />
        </div>

        {/* Right sidebar: Yield + Linked outfits */}
        <div className="w-64 shrink-0 pt-1 flex flex-col gap-8">
          {/* Yield surface */}
          {yieldCount !== null && (
            <div>
              <p className="text-[10px] tracking-[0.25em] text-[#6B6B6B] mb-4 pb-3 border-b border-[#E2E0DB]">
                COMPOSITIONAL YIELD
              </p>
              <div className="bg-white border border-[#E2E0DB] p-4">
                <p className="text-[36px] tracking-[0.05em] text-[#4A4E57] leading-none mb-2">
                  {yieldCount}
                </p>
                <p className="text-[10px] tracking-[0.18em] text-[#6B6B6B] mb-4 leading-relaxed">
                  {yieldCount === 0
                    ? 'NO COHERENT COMPOSITIONS IN THE CURRENT LIBRARY. ADD MORE READY ITEMS.'
                    : `OUTFIT${yieldCount === 1 ? '' : 'S'} THIS PIECE COULD ANCHOR AGAINST YOUR READY/LIVE LIBRARY.`}
                </p>
                {yieldCount > 0 && (
                  <Link
                    href={`/admin/composer?anchor=${item.item_id}`}
                    className="block bg-[#0A0A0A] text-white px-4 py-2.5 text-[10px] tracking-[0.20em] text-center hover:bg-[#333] transition-colors duration-300"
                  >
                    OPEN COMPOSER →
                  </Link>
                )}
              </div>
            </div>
          )}

          {/* Linked outfits */}
          {linkedOutfits.length > 0 && (
            <div>
              <p className="text-[10px] tracking-[0.25em] text-[#6B6B6B] mb-4 pb-3 border-b border-[#E2E0DB]">
                LINKED OUTFITS ({linkedOutfits.length})
              </p>
            <div className="flex flex-col gap-3">
              {linkedOutfits.map((outfit) => (
                <Link
                  key={outfit.outfit_id}
                  href={`/outfit/${outfit.outfit_id}`}
                  target="_blank"
                  className="group border border-[#E2E0DB] bg-white hover:border-[#0A0A0A] transition-colors duration-300 overflow-hidden"
                >
                  {outfit.image_url ? (
                    <img
                      src={outfit.image_url}
                      alt={outfit.aesthetic_label || 'Outfit'}
                      className="w-full aspect-[3/4] object-cover"
                    />
                  ) : (
                    <div className="w-full aspect-[3/4] bg-[#F2F2F0] flex items-center justify-center">
                      <span className="text-[9px] tracking-[0.15em] text-[#A8A8A4]">NO IMAGE</span>
                    </div>
                  )}
                  <div className="p-3">
                    <p className="text-[10px] tracking-[0.12em] text-[#4A4E57] truncate">
                      {(outfit.aesthetic_label || 'Untitled').toUpperCase()}
                    </p>
                    {outfit.celebrity_name && (
                      <p className="text-[9px] tracking-[0.10em] text-[#A8A8A4] mt-0.5 truncate">
                        {outfit.celebrity_name}
                      </p>
                    )}
                    <p className="text-[9px] tracking-[0.10em] text-[#C4A882] mt-1 group-hover:text-[#4A4E57] transition-colors">
                      VIEW →
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
          )}

          {/* Danger zone — delete this item (two-step confirm) */}
          <DeleteItemButton itemId={item.item_id} productName={item.product_name} />
        </div>
      </div>
    </div>
  )
}
