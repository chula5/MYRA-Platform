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

      {/* Table */}
      {items.length === 0 ? (
        <div className="py-20 text-center">
          <p className="text-[11px] tracking-[0.20em] text-[#A8A8A4]">
            NO ITEMS YET. ADD YOUR FIRST ITEM.
          </p>
        </div>
      ) : (
        <div className="border border-[#E2E0DB] bg-white rounded-[3px] overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[56px_1fr_2fr_1.3fr_110px_100px_100px] gap-4 px-6 py-3 border-b border-[#E2E0DB] bg-[#F8F8F6]">
            <p className="text-[9px] tracking-[0.20em] text-[#A8A8A4]">IMAGE</p>
            <p className="text-[9px] tracking-[0.20em] text-[#A8A8A4]">ITEM TYPE</p>
            <p className="text-[9px] tracking-[0.20em] text-[#A8A8A4]">PRODUCT NAME</p>
            <p className="text-[9px] tracking-[0.20em] text-[#A8A8A4]">BRAND</p>
            <p className="text-[9px] tracking-[0.20em] text-[#A8A8A4]">STOCK</p>
            <p className="text-[9px] tracking-[0.20em] text-[#A8A8A4]">STATUS</p>
            <p className="text-[9px] tracking-[0.20em] text-[#A8A8A4]">ACTIONS</p>
          </div>

          {/* Rows */}
          {items.map((item) => (
            <div
              key={item.item_id}
              className="grid grid-cols-[56px_1fr_2fr_1.3fr_110px_100px_100px] gap-4 px-6 py-4 border-b border-[#E2E0DB] last:border-b-0 items-center hover:bg-[#F8F8F6] transition-colors duration-300"
            >
              {/* Image */}
              <div className="w-10 h-10 border border-[#E2E0DB] overflow-hidden bg-[#F2F2F0] shrink-0">
                {item.image_url ? (
                  <img
                    src={item.image_url}
                    alt={item.product_name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <span className="text-[7px] text-[#A8A8A4]">—</span>
                  </div>
                )}
              </div>

              {/* Item type */}
              <div>
                <span className="inline-block bg-[#F2F2F0] px-2 py-1 text-[9px] tracking-[0.15em] text-[#6B6B6B] rounded-[2px]">
                  {item.item_type.replace(/_/g, ' ').toUpperCase()}
                </span>
              </div>

              {/* Product name */}
              <p className="text-[11px] tracking-[0.12em] text-[#0A0A0A] truncate">
                {item.product_name.toUpperCase()}
              </p>

              {/* Brand */}
              <p className="text-[10px] tracking-[0.12em] text-[#6B6B6B]">
                {item.brand?.name?.toUpperCase() ?? '—'}
              </p>

              {/* Stock */}
              <div>
                <StockBadge status={item.stock_status} />
              </div>

              {/* Status */}
              <div>
                <StatusBadge status={item.status} />
              </div>

              {/* Actions */}
              <div>
                <Link
                  href={`/admin/items/${item.item_id}/edit`}
                  className="text-[10px] tracking-[0.15em] text-[#6B6B6B] hover:text-[#0A0A0A] transition-colors duration-300"
                >
                  EDIT →
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
