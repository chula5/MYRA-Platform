'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import StatusBadge from '@/components/admin/StatusBadge'
import StockBadge from '@/components/admin/StockBadge'
import { PICKER_COLOURS, PICKER_TYPES } from '@/components/admin/ItemPickerModal'
import type { ItemFacet, ItemWithBrand } from '@/lib/admin-queries'
import { createOutfitFromSelectedItems, deleteItems } from '@/app/admin/items/actions'

const SELECT_CLS = 'text-[10px] tracking-[0.09em] uppercase px-3 py-2 border border-[#E2E0DB] rounded-[10px] bg-white text-[#4A4E57] hover:border-[#0A0A0A] focus:outline-none focus:border-[#0A0A0A] transition-colors max-w-[240px]'
const TYPE_LABELS = new Map(PICKER_TYPES.map((t) => [t.value, t.label]))
const COLOUR_LABELS = new Map(PICKER_COLOURS.map((c) => [c.value, c.label]))

interface Props {
  items: ItemWithBrand[]
  total: number
  page: number
  pageSize: number
  brands: ItemFacet[]
  types: ItemFacet[]
  colours: ItemFacet[]
}

export default function ItemsGrid({ items, total, page, pageSize, brands, types, colours }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle')
  const [selectMode, setSelectMode] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)

  // Filters and page live in the URL — the server sends back one page of
  // matching items plus facet counts, so this stays fast at 10k+ items.
  const fBrand = searchParams.get('brand') ?? ''
  const fType = searchParams.get('type') ?? ''
  const fColour = searchParams.get('colour') ?? ''
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  function setParam(key: string, value: string) {
    const sp = new URLSearchParams(searchParams.toString())
    if (value) sp.set(key, value)
    else sp.delete(key)
    if (key !== 'page') sp.delete('page') // filter change restarts at page 1
    setSelected(new Set())
    router.push(`/admin/items${sp.toString() ? `?${sp.toString()}` : ''}`)
  }

  const shown = items

  function toggle(itemId: string) {
    setSelected((prev) => {
      const n = new Set(prev)
      if (n.has(itemId)) n.delete(itemId)
      else n.add(itemId)
      return n
    })
  }

  function selectAll() {
    setSelected(new Set(shown.map((i) => i.item_id)))
  }

  function clearAll() {
    setSelected(new Set())
    setDeleteConfirm(false)
  }

  async function handleDeleteSelected() {
    const chosen = Array.from(selected)
    if (chosen.length === 0) return
    setDeleting(true)
    setCreateError(null)
    const res = await deleteItems(chosen)
    setDeleting(false)
    setDeleteConfirm(false)
    if (res.error) { setCreateError(res.error); return }
    setSelected(new Set())
    router.refresh()
  }

  async function handleCreateOutfit() {
    const chosen = Array.from(selected)
    if (chosen.length === 0) return
    setCreating(true)
    setCreateError(null)
    const res = await createOutfitFromSelectedItems(chosen)
    setCreating(false)
    if (res.error || !res.outfitId || !res.projectId) {
      setCreateError(res.error ?? 'Could not create outfit')
      return
    }
    // Jump straight into the outfit editor with the items already linked
    router.push(`/admin/projects/${res.projectId}/outfits/${res.outfitId}/edit`)
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
      {/* Brand / type / colour filter dropdowns + pagination */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <select value={fBrand} onChange={(e) => setParam('brand', e.target.value)} className={SELECT_CLS}>
          <option value="">ALL BRANDS</option>
          {brands.map((b) => (
            <option key={b.value} value={b.value}>{b.value.toUpperCase()} · {b.count}</option>
          ))}
        </select>
        <select value={fType} onChange={(e) => setParam('type', e.target.value)} className={SELECT_CLS}>
          <option value="">ALL TYPES</option>
          {types.map((t) => (
            <option key={t.value} value={t.value}>{TYPE_LABELS.get(t.value) ?? t.value.replace(/_/g, ' ').toUpperCase()} · {t.count}</option>
          ))}
        </select>
        <select value={fColour} onChange={(e) => setParam('colour', e.target.value)} className={SELECT_CLS}>
          <option value="">ALL COLOURS</option>
          {colours.map((c) => (
            <option key={c.value} value={c.value}>{COLOUR_LABELS.get(c.value) ?? c.value.toUpperCase()} · {c.count}</option>
          ))}
        </select>
        <span className="text-[10px] tracking-[0.12em] text-[#6B6B6B] ml-1">
          {total} ITEM{total === 1 ? '' : 'S'}{totalPages > 1 ? ` · PAGE ${page} OF ${totalPages}` : ''}
        </span>
        {totalPages > 1 && (
          <span className="flex items-center gap-1 ml-auto">
            <button
              disabled={page <= 1}
              onClick={() => setParam('page', String(page - 1))}
              className="text-[10px] tracking-[0.09em] px-3 py-2 border border-[#E2E0DB] rounded-[10px] text-[#6B6B6B] hover:border-[#0A0A0A] hover:text-[#4A4E57] transition-colors disabled:opacity-40 disabled:hover:border-[#E2E0DB]"
            >
              ← PREV
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => setParam('page', String(page + 1))}
              className="text-[10px] tracking-[0.09em] px-3 py-2 border border-[#E2E0DB] rounded-[10px] text-[#6B6B6B] hover:border-[#0A0A0A] hover:text-[#4A4E57] transition-colors disabled:opacity-40 disabled:hover:border-[#E2E0DB]"
            >
              NEXT →
            </button>
          </span>
        )}
      </div>

      {/* Select-mode toolbar — DELETE lives on the far LEFT, deliberately away
          from Copy / Create on the right so it can't be hit by accident. */}
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        {/* Left: delete (two-step confirm) */}
        <div className="flex items-center gap-2">
          {selectMode && hasSelection && (
            deleteConfirm ? (
              <>
                <button
                  type="button"
                  onClick={handleDeleteSelected}
                  disabled={deleting}
                  className="text-[10px] tracking-[0.09em] px-4 py-1.5 bg-[#B83A3A] text-white hover:bg-[#9c2f2f] transition-colors duration-200 disabled:opacity-50"
                >
                  {deleting ? 'DELETING…' : `CONFIRM DELETE (${selected.size})`}
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteConfirm(false)}
                  disabled={deleting}
                  className="text-[10px] tracking-[0.09em] px-3 py-1.5 border border-[#E2E0DB] text-[#6B6B6B] hover:border-[#0A0A0A] hover:text-[#4A4E57] transition-colors duration-200 disabled:opacity-50"
                >
                  CANCEL
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setDeleteConfirm(true)}
                className="text-[10px] tracking-[0.09em] px-3 py-1.5 border border-[#E8B4B4] text-[#B83A3A] hover:bg-[#B83A3A] hover:text-white hover:border-[#B83A3A] transition-colors duration-200"
              >
                🗑 DELETE
              </button>
            )
          )}
        </div>

        {/* Right: clear / copy / create / select controls */}
        <div className="flex items-center gap-2 flex-wrap">
          {selectMode && hasSelection && (
            <>
              <span className="text-[10px] tracking-[0.09em] text-[#4A4E57] mr-1">
                {selected.size} SELECTED
              </span>
              <button
                type="button"
                onClick={clearAll}
                disabled={creating || deleting}
                className="text-[10px] tracking-[0.09em] px-3 py-1.5 border border-[#E2E0DB] text-[#6B6B6B] hover:border-[#0A0A0A] hover:text-[#4A4E57] transition-colors duration-200 disabled:opacity-50"
              >
                CLEAR
              </button>
              <button
                type="button"
                onClick={handleCopySelected}
                disabled={creating || deleting}
                className="text-[10px] tracking-[0.09em] px-3 py-1.5 border border-[#E2E0DB] text-[#6B6B6B] hover:border-[#0A0A0A] hover:text-[#4A4E57] transition-colors duration-200 disabled:opacity-50"
              >
                {copyState === 'copied'
                  ? 'COPIED ✓'
                  : copyState === 'error'
                  ? 'COPY FAILED'
                  : '⎘ COPY'}
              </button>
              <button
                type="button"
                onClick={handleCreateOutfit}
                disabled={creating || deleting}
                className="text-[10px] tracking-[0.09em] px-4 py-1.5 bg-[#0A0A0A] text-white hover:bg-[#333] transition-colors duration-200 disabled:opacity-50"
              >
                {creating ? 'CREATING…' : `CREATE OUTFIT → (${selected.size})`}
              </button>
              <span className="mx-1 text-[#E2E0DB]">|</span>
            </>
          )}
          <button
            type="button"
            onClick={() => {
              setSelectMode((v) => !v)
              if (selectMode) clearAll()
            }}
            className={`text-[10px] tracking-[0.09em] px-3 py-1.5 transition-colors duration-200 ${
              selectMode
                ? 'bg-[#0A0A0A] text-white'
                : 'border border-[#E2E0DB] text-[#6B6B6B] hover:border-[#0A0A0A] hover:text-[#4A4E57]'
            }`}
          >
            {selectMode ? 'EXIT SELECT' : 'SELECT ITEMS'}
          </button>
          {selectMode && (
            <button
              type="button"
              onClick={selected.size === shown.length ? clearAll : selectAll}
              className="text-[10px] tracking-[0.09em] px-3 py-1.5 border border-[#E2E0DB] text-[#6B6B6B] hover:border-[#0A0A0A] hover:text-[#4A4E57] transition-colors duration-200"
            >
              {selected.size === shown.length ? 'CLEAR ALL' : 'SELECT ALL'}
            </button>
          )}
        </div>
      </div>
      {createError && (
        <p className="text-[10px] tracking-[0.09em] text-[#B83A3A] mb-3 text-right">
          {createError.toUpperCase()}
        </p>
      )}

      {/* Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {shown.map((item) => {
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
                    <span className="text-[9px] tracking-[0.068em] text-[#A8A8A4]">NO IMAGE</span>
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
                <p className="text-[9px] tracking-[0.09em] text-[#A8A8A4] mb-1 truncate">
                  {item.brand?.name?.toUpperCase() ?? '—'}
                </p>
                <p className="text-[11px] tracking-[0.045em] text-[#4A4E57] mb-2 line-clamp-2 leading-snug min-h-[28px]">
                  {item.product_name.toUpperCase()}
                </p>
                <div className="flex items-center justify-between">
                  <span className="inline-block bg-[#F2F2F0] px-2 py-0.5 text-[8px] tracking-[0.068em] text-[#6B6B6B] rounded-[10px]">
                    {item.item_type.replace(/_/g, ' ').toUpperCase()}
                  </span>
                  {!selectMode && (
                    <span className="text-[9px] tracking-[0.068em] text-[#A8A8A4] group-hover:text-[#4A4E57] transition-colors">
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

      {shown.length === 0 && (
        <div className="py-20 text-center">
          <p className="text-[11px] tracking-[0.09em] text-[#A8A8A4]">
            {total === 0 ? 'NOTHING MATCHES THESE FILTERS.' : 'NO ITEMS ON THIS PAGE.'}
          </p>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-8">
          <button
            disabled={page <= 1}
            onClick={() => setParam('page', String(page - 1))}
            className="text-[10px] tracking-[0.09em] px-4 py-2 border border-[#E2E0DB] rounded-[10px] text-[#6B6B6B] hover:border-[#0A0A0A] hover:text-[#4A4E57] transition-colors disabled:opacity-40 disabled:hover:border-[#E2E0DB]"
          >
            ← PREV
          </button>
          <span className="text-[10px] tracking-[0.12em] text-[#6B6B6B]">PAGE {page} OF {totalPages}</span>
          <button
            disabled={page >= totalPages}
            onClick={() => setParam('page', String(page + 1))}
            className="text-[10px] tracking-[0.09em] px-4 py-2 border border-[#E2E0DB] rounded-[10px] text-[#6B6B6B] hover:border-[#0A0A0A] hover:text-[#4A4E57] transition-colors disabled:opacity-40 disabled:hover:border-[#E2E0DB]"
          >
            NEXT →
          </button>
        </div>
      )}
    </>
  )
}
