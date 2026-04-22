import Link from 'next/link'
import { getAllItems } from '@/lib/admin-queries'
import StatusBadge from '@/components/admin/StatusBadge'
import StockBadge from '@/components/admin/StockBadge'

const STATUS_TABS = ['all', 'draft', 'ready', 'live', 'archived'] as const

interface PageProps {
  searchParams: Promise<{ status?: string; stock?: string }>
}

export default async function ItemsPage({ searchParams }: PageProps) {
  const { status, stock } = await searchParams
  const activeTab = status || 'all'
  const stockFilter =
    stock === 'flagged' || stock === 'out_of_stock' || stock === 'low_stock' ? stock : undefined
  const items = await getAllItems(activeTab === 'all' ? undefined : activeTab, stockFilter)

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <p className="text-[11px] tracking-[0.25em] text-[#6B6B6B] mb-2">ADMIN STUDIO</p>
          <h1 className="text-[28px] tracking-[0.10em] text-[#0A0A0A]">ITEM LIBRARY</h1>
        </div>
        <Link
          href="/admin/items/new"
          className="bg-[#0A0A0A] text-white px-8 py-3.5 text-[11px] tracking-[0.20em] transition-colors duration-400 hover:bg-[#333]"
        >
          NEW ITEM →
        </Link>
      </div>

      {/* Active stock filter chip */}
      {stockFilter && (
        <div className="mb-4">
          <Link
            href="/admin/items"
            className="inline-flex items-center gap-2 px-3 py-1.5 text-[10px] tracking-[0.20em] bg-[#FDECEC] text-[#B83A3A] rounded-[2px] hover:bg-[#FBDCDC] transition-colors"
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
            className={`px-4 py-2 text-[10px] tracking-[0.20em] transition-all duration-300 rounded-[2px] ${
              activeTab === tab
                ? 'bg-[#0A0A0A] text-white'
                : 'border border-[#E2E0DB] text-[#6B6B6B] hover:border-[#0A0A0A] hover:text-[#0A0A0A]'
            }`}
          >
            {tab.toUpperCase().replace('_', ' ')}
          </Link>
        ))}
      </div>

      {/* Grid */}
      {items.length === 0 ? (
        <div className="py-20 text-center">
          <p className="text-[11px] tracking-[0.20em] text-[#A8A8A4]">
            NO ITEMS YET. ADD YOUR FIRST ITEM.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {items.map((item) => (
            <Link
              key={item.item_id}
              href={`/admin/items/${item.item_id}/edit`}
              className="group block bg-white border border-[#E2E0DB] hover:border-[#0A0A0A] transition-colors duration-300 overflow-hidden"
            >
              {/* Image */}
              <div className="aspect-[3/4] bg-[#F8F8F6] overflow-hidden relative">
                {item.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.image_url}
                    alt={item.product_name}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <span className="text-[9px] tracking-[0.15em] text-[#A8A8A4]">NO IMAGE</span>
                  </div>
                )}
                {/* Badges overlaid top-left */}
                <div className="absolute top-2 left-2 flex flex-col gap-1">
                  <StatusBadge status={item.status} />
                  {item.stock_status && item.stock_status !== 'in_stock' && (
                    <StockBadge status={item.stock_status} size="sm" />
                  )}
                </div>
              </div>

              {/* Body */}
              <div className="p-3">
                <p className="text-[9px] tracking-[0.20em] text-[#A8A8A4] mb-1 truncate">
                  {item.brand?.name?.toUpperCase() ?? '—'}
                </p>
                <p className="text-[11px] tracking-[0.10em] text-[#0A0A0A] mb-2 line-clamp-2 leading-snug min-h-[28px]">
                  {item.product_name.toUpperCase()}
                </p>
                <div className="flex items-center justify-between">
                  <span className="inline-block bg-[#F2F2F0] px-2 py-0.5 text-[8px] tracking-[0.15em] text-[#6B6B6B] rounded-[2px]">
                    {item.item_type.replace(/_/g, ' ').toUpperCase()}
                  </span>
                  <span className="text-[9px] tracking-[0.15em] text-[#A8A8A4] group-hover:text-[#0A0A0A] transition-colors">
                    EDIT →
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
