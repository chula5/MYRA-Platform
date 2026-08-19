import Link from 'next/link'
import { getItemsPage } from '@/lib/admin-queries'
import ItemsGrid from './ItemsGrid'

const STATUS_TABS = ['all', 'draft', 'ready', 'live', 'archived'] as const

interface PageProps {
  searchParams: Promise<{ status?: string; stock?: string; brand?: string; type?: string; colour?: string; page?: string }>
}

export default async function ItemsPage({ searchParams }: PageProps) {
  const { status, stock, brand, type, colour, page } = await searchParams
  const activeTab = status || 'all'
  const stockFilter =
    stock === 'flagged' || stock === 'out_of_stock' || stock === 'low_stock' ? stock : undefined
  const data = await getItemsPage({
    status: activeTab === 'all' ? undefined : activeTab,
    stockFilter,
    brand: brand || undefined,
    itemType: type || undefined,
    colour: colour || undefined,
    page: page ? parseInt(page, 10) || 1 : 1,
  })

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <p className="text-[11px] tracking-[0.113em] text-[#6B6B6B] mb-2">ADMIN STUDIO</p>
          <h1 className="text-[28px] tracking-[0.045em] text-[#4A4E57]">ITEM LIBRARY</h1>
        </div>
        <Link
          href="/admin/items/new"
          className="bg-[#0A0A0A] text-white px-8 py-3.5 text-[11px] tracking-[0.09em] transition-colors duration-400 hover:bg-[#333]"
        >
          NEW ITEM →
        </Link>
      </div>

      {/* Active stock filter chip */}
      {stockFilter && (
        <div className="mb-4">
          <Link
            href="/admin/items"
            className="inline-flex items-center gap-2 px-3 py-1.5 text-[10px] tracking-[0.09em] bg-[#FDECEC] text-[#B83A3A] rounded-[10px] hover:bg-[#FBDCDC] transition-colors"
          >
            STOCK: {stockFilter.toUpperCase().replace('_', ' ')} · CLEAR ×
          </Link>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex items-center gap-2 mb-8 border-b border-[#E2E0DB] pb-4">
        {STATUS_TABS.map((tab) => (
          <Link
            key={tab}
            href={tab === 'all' ? '/admin/items' : `/admin/items?status=${tab}`}
            className={`px-4 py-2 text-[10px] tracking-[0.09em] transition-all duration-300 rounded-[10px] ${
              activeTab === tab
                ? 'bg-[#0A0A0A] text-white'
                : 'border border-[#E2E0DB] text-[#6B6B6B] hover:border-[#0A0A0A] hover:text-[#4A4E57]'
            }`}
          >
            {tab.toUpperCase().replace('_', ' ')}
          </Link>
        ))}
      </div>

      {/* Grid */}
      <ItemsGrid {...data} />
    </div>
  )
}
