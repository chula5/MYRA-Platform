'use client'

import { useState } from 'react'
import Link from 'next/link'
import StatusBadge from '@/components/admin/StatusBadge'
import StockBadge from '@/components/admin/StockBadge'
import type { ItemWithBrand } from '@/lib/admin-queries'

export default function ItemsGrid({ items }: { items: ItemWithBrand[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle')
  const [selectMode, setSelectMode] = useState(false)

  function toggle(itemId: string) {
    setSelected((prev) => {
      const n = new Set(prev)
      if (n.has(itemId)) n.delete(itemId)
      else n.add(itemId)
      return n
    })
  }

  function selectAll() {
    setSelected(new Set(items.map((i) => i.item_id)))
  }

  function clearAll() {
    setSelected(new Set())
  }

  async function handleCopySelected() {
    const chosen = items.filter((i) => selected.has(i.item_id))
    if (chosen.length === 0) return

    const headers = ['ITEM TYPE', 'PRODUCT NAME', 'BRAND', 'COST', 'RETAILER URL', 'IMAGE URL']
    const rows = chosen.map((it) => {
      const cost = it.price ? `${it.currency ?? ''} ${it.price}`.trim() : ''
      return [
        it.item_type?.replace(/_/g, ' ') ?? '',
        it.product_name ?? '',
        it.brand?.name ?? '',
        cost,
        it.retailer_url ?? '',
        it.image_url ?? '',
      ]
        .map((v) => String(v).replace(/\t/g, ' ').replace(/\r?\n/g, ' '))
        .join('\t')
    })
    const tsv = [headers.join('\t'), ...rows].join('\n')

    try {
      await navigator.clipboard.writeText(tsv)
      setCopyState('copied')
      setTimeout(() => setCopyState('idle'), 2000)
    } catch (err) {
      console.error('[handleCopySelected]', err)
      setCopyState('error')
      setTimeout(() => setCopyState('idle'), 2500)
    }
  }

  const hasSelection = selected.size > 0

  return (
    <>
      {/* Select-mode toggle */}
      <div className="flex items-center justify-end gap-2 mb-4">
        <button
          type="button"
          onClick={() => {
            setSelectMode((v) => !v)
            if (selectMode) clearAll()
          }}
          className={`text-[10px] tracking-[0.20em] px-3 py-1.5 transition-colors duration-200 ${
            selectMode
              ? 'bg-[#0A0A0A] text-white'
              : 'border border-[#E2E0DB] text-[#6B6B6B] hover:border-[#0A0A0A] hover:text-[#0A0A0A]'
          }`}
        >
          {selectMode ? 'EXIT SELECT' : 'SELECT ITEMS'}
        </button>
        {selectMode && (
          <button
            type="button"
            onClick={selected.size === items.length ? clearAll : selectAll}
            className="text-[10px] tracking-[0.20em] px-3 py-1.5 border border-[#E2E0DB] text-[#6B6B6B] hover:border-[#0A0A0A] hover:text-[#0A0A0A] transition-colors duration-200"
          >
            {selected.size === items.length ? 'CLEAR ALL' : 'SELECT ALL'}
          </button>
        )}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 pb-24">
        {items.map((item) => {
          const isSelected = selected.has(item.item_id)
          const tile = (
            <>
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

                {/* Selection checkbox */}
                {selectMode && (
                  <div
                    className={`absolute top-2 right-2 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${
                      isSelected ? 'bg-[#0A0A0A] border-[#0A0A0A]' : 'bg-white/80 border-[#E2E0DB]'
                    }`}
                  >
                    {isSelected && <span className="text-white text-[12px] leading-none">✓</span>}
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
                  {!selectMode && (
                    <span className="text-[9px] tracking-[0.15em] text-[#A8A8A4] group-hover:text-[#0A0A0A] transition-colors">
                      EDIT →
                    </span>
                  )}
                </div>
              </div>
            </>
          )

          if (selectMode) {
            return (
              <button
                key={item.item_id}
                type="button"
                onClick={() => toggle(item.item_id)}
                className={`group block bg-white border text-left transition-colors duration-300 overflow-hidden ${
                  isSelected ? 'border-[#0A0A0A]' : 'border-[#E2E0DB] hover:border-[#0A0A0A]'
                }`}
              >
                {tile}
              </button>
            )
          }
          return (
            <Link
              key={item.item_id}
              href={`/admin/items/${item.item_id}/edit`}
              className="group block bg-white border border-[#E2E0DB] hover:border-[#0A0A0A] transition-colors duration-300 overflow-hidden"
            >
              {tile}
            </Link>
          )
        })}
      </div>

      {/* Sticky selection bar */}
      {selectMode && hasSelection && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-[#E2E0DB] px-6 py-3 flex items-center justify-between gap-4 shadow-[0_-4px_16px_rgba(0,0,0,0.06)]">
          <p className="text-[10px] tracking-[0.20em] text-[#0A0A0A]">
            {selected.size} SELECTED
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={clearAll}
              className="text-[10px] tracking-[0.20em] px-4 py-2 border border-[#E2E0DB] text-[#6B6B6B] hover:border-[#0A0A0A] hover:text-[#0A0A0A] transition-colors"
            >
              CLEAR
            </button>
            <button
              type="button"
              onClick={handleCopySelected}
              className="text-[10px] tracking-[0.20em] px-5 py-2 bg-[#0A0A0A] text-white hover:bg-[#333] transition-colors"
            >
              {copyState === 'copied'
                ? 'COPIED ✓'
                : copyState === 'error'
                ? 'COPY FAILED'
                : '⎘ COPY SELECTED'}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
