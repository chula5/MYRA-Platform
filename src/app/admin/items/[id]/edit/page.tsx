import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getItem, getAllBrands, getOutfitsForItem } from '@/lib/admin-queries'
import ItemForm from '@/components/admin/ItemForm'
import { updateItem, updateItemStatus } from '@/app/admin/items/actions'
import StatusBadge from '@/components/admin/StatusBadge'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function EditItemPage({ params }: PageProps) {
  const { id } = await params
  const [item, brands, linkedOutfits] = await Promise.all([
    getItem(id),
    getAllBrands(),
    getOutfitsForItem(id),
  ])

  if (!item) {
    notFound()
  }

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
          className="text-[10px] tracking-[0.20em] text-[#6B6B6B] hover:text-[#0A0A0A] transition-colors duration-300 mb-4 inline-block"
        >
          ← ITEM LIBRARY
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[11px] tracking-[0.25em] text-[#6B6B6B] mb-2">EDIT ITEM</p>
            <h1 className="text-[28px] tracking-[0.10em] text-[#0A0A0A]">
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
                  className="border border-[#0A0A0A] bg-transparent text-[#0A0A0A] px-6 py-2.5 text-[10px] tracking-[0.20em] hover:bg-[#0A0A0A] hover:text-white transition-colors duration-400"
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

        {/* Linked outfits sidebar */}
        {linkedOutfits.length > 0 && (
          <div className="w-64 shrink-0 pt-1">
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
                    <p className="text-[10px] tracking-[0.12em] text-[#0A0A0A] truncate">
                      {(outfit.aesthetic_label || 'Untitled').toUpperCase()}
                    </p>
                    {outfit.celebrity_name && (
                      <p className="text-[9px] tracking-[0.10em] text-[#A8A8A4] mt-0.5 truncate">
                        {outfit.celebrity_name}
                      </p>
                    )}
                    <p className="text-[9px] tracking-[0.10em] text-[#C4A882] mt-1 group-hover:text-[#0A0A0A] transition-colors">
                      VIEW →
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
