import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getAllBrands } from '@/lib/admin-queries'
import ItemForm from '@/components/admin/ItemForm'
import { createItem } from '@/app/admin/items/actions'

export default async function NewItemPage() {
  const brands = await getAllBrands()

  async function handleCreate(formData: FormData) {
    'use server'
    const result = await createItem(formData)
    if (!result.error) {
      redirect('/admin/items')
    }
    return result
  }

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
        <div>
          <p className="text-[11px] tracking-[0.25em] text-[#6B6B6B] mb-2">ADMIN STUDIO</p>
          <h1 className="text-[28px] tracking-[0.10em] text-[#0A0A0A]">NEW ITEM</h1>
        </div>
      </div>

      <ItemForm brands={brands} action={handleCreate} />
    </div>
  )
}
