'use client'

import { useEffect, useRef } from 'react'
import Image from 'next/image'
import type { Item, Brand } from '@/types/database'

type SourceItem = Item & { brand: Brand }

interface SourcePanelProps {
  items: SourceItem[]
  onClose: () => void
  isOpen: boolean
}

export default function SourcePanel({ items, onClose, isOpen }: SourcePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return

    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    // Small delay so the opening click doesn't immediately close
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClick)
    }, 100)

    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleClick)
    }
  }, [isOpen, onClose])

  // Trap focus when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  if (!isOpen && !items.length) return null

  return (
    <>
      {/* Backdrop — very subtle, panel overlays image rather than blocks it */}
      <div
        className={`
          fixed inset-0 z-40
          transition-opacity duration-400
          ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}
        `}
      />

      {/* Panel — slides in from LEFT */}
      <div
        ref={panelRef}
        className={`
          fixed top-0 left-0 h-full z-50
          w-[280px] max-[768px]:w-full
          bg-white
          flex flex-col
          transition-transform duration-[350ms] ease-out
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}
          shadow-[4px_0_24px_rgba(0,0,0,0.08)]
        `}
        aria-hidden={!isOpen}
      >
        {/* Panel header */}
        <div className="flex items-center justify-between px-5 pt-6 pb-4 border-b border-[#E2E0DB]">
          <span className="text-[11px] tracking-[0.25em] text-[#0A0A0A]">
            SOURCED PIECES
          </span>
          <button
            onClick={onClose}
            aria-label="Close source panel"
            className="text-[#0A0A0A] hover:opacity-50 transition-opacity duration-300 text-lg leading-none"
          >
            ×
          </button>
        </div>

        {/* Item list — scrollable */}
        <div className="flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <div className="px-5 pt-8 text-center">
              <p className="text-[11px] tracking-[0.15em] text-[#A8A8A4]">
                NO ITEMS SOURCED YET
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[#E2E0DB]">
              {items.map((item) => (
                <SourceItemRow key={item.item_id} item={item} />
              ))}
            </div>
          )}
        </div>

        {/* Panel CTA */}
        <div className="p-5 border-t border-[#E2E0DB]">
          <button
            onClick={() => {
              // Open the first item's retailer URL as primary action
              const firstItem = items[0]
              if (firstItem?.retailer_url) {
                window.open(firstItem.retailer_url, '_blank', 'noopener,noreferrer')
              }
            }}
            className="
              w-full flex items-center justify-center gap-2
              bg-[#0A0A0A] text-white
              text-[11px] tracking-[0.20em]
              py-3.5 rounded-full
              transition-opacity duration-400 hover:opacity-85
            "
          >
            SOURCE THESE PIECES <span className="text-sm">→</span>
          </button>
        </div>
      </div>
    </>
  )
}

// ── Individual item row ───────────────────────────────────────

function SourceItemRow({ item }: { item: SourceItem }) {
  const handleClick = () => {
    if (item.retailer_url) {
      window.open(item.retailer_url, '_blank', 'noopener,noreferrer')
    }
  }

  return (
    <div
      className="
        flex items-center gap-3 px-5 py-4
        cursor-pointer
        hover:bg-[#FAFAF8] transition-colors duration-300
        group
      "
      onClick={handleClick}
      role="link"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && handleClick()}
      aria-label={`View ${item.product_name} by ${item.brand?.name}`}
    >
      {/* Thumbnail */}
      <div className="relative w-[60px] h-[60px] flex-shrink-0 rounded-sm overflow-hidden bg-[#F2F2F2]">
        {item.image_url ? (
          <Image
            src={item.image_url}
            alt={item.product_name}
            fill
            className="object-cover"
            sizes="60px"
          />
        ) : (
          <div className="w-full h-full bg-[#E2E0DB]" />
        )}
      </div>

      {/* Item info */}
      <div className="flex-1 min-w-0">
        <p className="text-[12px] tracking-[0.12em] text-[#0A0A0A] truncate">
          {item.brand?.name ?? 'BRAND'}
        </p>
        <p className="text-[12px] tracking-[0.08em] text-[#0A0A0A] truncate">
          {item.product_name}
        </p>
        {item.retailer_url && (
          <p className="text-[12px] tracking-[0.10em] text-[#0A0A0A] mt-0.5">
            {/* Price would come from item data — placeholder */}
            VIEW ITEM
          </p>
        )}
      </div>

      {/* Link arrow */}
      <span className="text-[#0A0A0A] text-base opacity-40 group-hover:opacity-100 transition-opacity duration-300 flex-shrink-0">
        ↗
      </span>
    </div>
  )
}
