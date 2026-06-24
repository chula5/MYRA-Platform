import Link from 'next/link'
import { getAllBrands } from '@/lib/admin-queries'
import ItemForm from '@/components/admin/ItemForm'
import { createItem } from '@/app/admin/items/actions'

// Brand list must reflect any brands just added via Batch Ingest or createBrand.
// Without this, the dropdown serves a stale snapshot of brands.
export const dynamic = 'force-dynamic'

export default async function NewItemPage() {
  const brands = await getAllBrands()

  async function handleCreate(formData: FormData) {
    'use server'
    return createItem(formData)
  }

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
        <div>
          <p className="text-[11px] tracking-[0.25em] text-[#6B6B6B] mb-2">ADMIN STUDIO</p>
          <h1 className="text-[28px] tracking-[0.10em] text-[#4A4E57]">NEW ITEM</h1>
        </div>
      </div>

      <ItemForm brands={brands} action={handleCreate} />
    </div>
  )
}
