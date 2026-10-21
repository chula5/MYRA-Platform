'use client'

// BUILD AN OUTFIT — say the look ("a blue silk dress, brown Isabel Marant
// heels and a leather jacket") and the library comes back as one row per
// piece. Tap one piece in each row and CREATE OUTFIT, or hand the sentence to
// the Composer to put the looks together.

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import StatusBadge from '@/components/admin/StatusBadge'
import StockBadge from '@/components/admin/StockBadge'
import { thumbUrl } from '@/lib/image-utils'
import { createOutfitFromSelectedItems } from '@/app/admin/items/actions'
import type { AskGroup } from './ask'

const ROW = 12

export function AskBar({ ask }: { ask: string }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [text, setText] = useState(ask)
  useEffect(() => setText(ask), [ask])

  function go(next: string) {
    const sp = new URLSearchParams()
    const status = searchParams.get('status')
    if (status) sp.set('status', status)
    if (next.trim()) sp.set('ask', next.trim())
    router.push(`/admin/items${sp.toString() ? `?${sp.toString()}` : ''}`)
  }

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); go(text) }}
      className="flex flex-col sm:flex-row gap-2 mb-6"
    >
      <div className="relative flex-1">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[10px] tracking-[0.12em] text-[#7C838B]">✦</span>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="BUILD AN OUTFIT — E.G. A BLUE SILK DRESS, BROWN ISABEL MARANT HEELS AND A LEATHER JACKET"
          aria-label="Describe an outfit"
          className="w-full text-[13px] tracking-[0.04em] pl-9 pr-10 py-3 border border-[#0A0A0A] rounded-[10px] bg-white text-[#4A4E57] placeholder:text-[#A8A8A4] placeholder:text-[11px] placeholder:tracking-[0.09em] focus:outline-none"
        />
        {text && (
          <button
            type="button"
            onClick={() => { setText(''); if (ask) go('') }}
            aria-label="Clear"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[14px] text-[#A8A8A4] hover:text-[#0A0A0A]"
          >
            ×
          </button>
        )}
      </div>
      <button
        type="submit"
        className="bg-[#0A0A0A] text-white px-6 py-3 text-[10px] tracking-[0.12em] rounded-[10px] hover:bg-[#333] transition-colors"
      >
        FIND THE PIECES →
      </button>
    </form>
  )
}

export default function AskOutfit({ ask, groups, error }: { ask: string; groups: AskGroup[]; error?: string }) {
  const router = useRouter()
  // One chosen piece per row — the best match to start.
  const [picked, setPicked] = useState<Record<number, string | null>>(() =>
    Object.fromEntries(groups.map((g, i) => [i, g.items[0]?.item_id ?? null])))
  const [open, setOpen] = useState<Record<number, boolean>>({})
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  useEffect(() => {
    setPicked(Object.fromEntries(groups.map((g, i) => [i, g.items[0]?.item_id ?? null])))
    setOpen({})
  }, [groups])

  const chosen = groups
    .map((g, i) => g.items.find((it) => it.item_id === picked[i]))
    .filter((x): x is AskGroup['items'][number] => !!x)

  async function create() {
    if (chosen.length === 0) return
    setCreating(true)
    setCreateError(null)
    const res = await createOutfitFromSelectedItems(chosen.map((c) => c.item_id))
    setCreating(false)
    if (res.error || !res.outfitId || !res.projectId) { setCreateError(res.error ?? 'Could not create outfit'); return }
    router.push(`/admin/projects/${res.projectId}/outfits/${res.outfitId}/edit`)
  }

  if (error) {
    return <p className="py-16 text-center text-[11px] tracking-[0.09em] text-[#B83A3A]">{error.toUpperCase()}</p>
  }

  return (
    <div className="pb-28">
      <p className="text-[10px] tracking-[0.12em] text-[#6B6B6B] mb-6">
        READ AS {groups.length} PIECE{groups.length === 1 ? '' : 'S'} · TAP ONE IN EACH ROW TO PUT IT IN THE LOOK
      </p>

      <div className="space-y-10">
        {groups.map((g, gi) => {
          const shown = open[gi] ? g.items : g.items.slice(0, ROW)
          return (
            <section key={gi}>
              <div className="flex items-baseline gap-3 mb-1 flex-wrap">
                <span className="text-[10px] tracking-[0.12em] text-[#A8A8A4]">{String(gi + 1).padStart(2, '0')}</span>
                <h2 className="text-[15px] tracking-[0.06em] text-[#4A4E57]">{g.label.toUpperCase()}</h2>
                <span className="text-[10px] tracking-[0.12em] text-[#6B6B6B]">
                  {g.total} MATCH{g.total === 1 ? '' : 'ES'}{g.total > g.items.length ? ` · BEST ${g.items.length} SHOWN` : ''}
                </span>
              </div>
              {g.relaxed && <p className="text-[10px] tracking-[0.08em] text-[#7C838B] mb-3">▲ {g.relaxed.toUpperCase()}</p>}
              {g.items.length === 0 ? (
                <p className="text-[11px] tracking-[0.09em] text-[#A8A8A4] py-6">NOTHING IN THE LIBRARY FOR THIS ONE.</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3 mt-3">
                  {shown.map((item) => {
                    const on = picked[gi] === item.item_id
                    return (
                      <div
                        key={item.item_id}
                        className={`group bg-white border transition-colors overflow-hidden ${on ? 'border-[#0A0A0A] ring-1 ring-[#0A0A0A]' : 'border-[#E2E0DB] hover:border-[#0A0A0A]'}`}
                      >
                        <button
                          type="button"
                          onClick={() => setPicked((p) => ({ ...p, [gi]: on ? null : item.item_id }))}
                          className="block w-full text-left"
                        >
                          <div className="aspect-[3/4] bg-[#F8F8F6] overflow-hidden relative">
                            {item.image_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={thumbUrl(item.image_url, 400)} alt={item.product_name} className="w-full h-full object-cover" loading="lazy" decoding="async" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-[9px] tracking-[0.068em] text-[#A8A8A4]">NO IMAGE</div>
                            )}
                            <div className="absolute top-2 left-2 flex flex-col gap-1">
                              <StatusBadge status={item.status} />
                              {item.stock_status && item.stock_status !== 'in_stock' && <StockBadge status={item.stock_status} size="sm" />}
                            </div>
                            <div className={`absolute top-2 right-2 w-6 h-6 rounded-full border-2 flex items-center justify-center ${on ? 'bg-[#0A0A0A] border-[#0A0A0A]' : 'bg-white/80 border-[#E2E0DB]'}`}>
                              {on && <span className="text-white text-[12px] leading-none">✓</span>}
                            </div>
                          </div>
                          <div className="px-3 pt-3">
                            <p className="text-[9px] tracking-[0.09em] text-[#A8A8A4] mb-1 truncate">{item.brand?.name?.toUpperCase() ?? '—'}</p>
                            <p className="text-[11px] tracking-[0.045em] text-[#4A4E57] line-clamp-2 leading-snug min-h-[28px]">{item.product_name.toUpperCase()}</p>
                          </div>
                        </button>
                        <div className="px-3 pb-3 pt-1 flex items-center justify-between">
                          <span className="text-[8px] tracking-[0.068em] text-[#6B6B6B]">{item.item_type.replace(/_/g, ' ').toUpperCase()}</span>
                          <Link href={`/admin/items/${item.item_id}/edit`} className="text-[9px] tracking-[0.068em] text-[#A8A8A4] hover:text-[#4A4E57]">EDIT →</Link>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
              {g.items.length > ROW && (
                <button
                  type="button"
                  onClick={() => setOpen((o) => ({ ...o, [gi]: !o[gi] }))}
                  className="mt-3 text-[10px] tracking-[0.09em] px-3 py-1.5 border border-[#E2E0DB] text-[#6B6B6B] hover:border-[#0A0A0A] hover:text-[#4A4E57] transition-colors"
                >
                  {open[gi] ? 'SHOW FEWER' : `SHOW ALL ${g.items.length}`}
                </button>
              )}
            </section>
          )
        })}
      </div>

      {/* The look so far — pinned to the bottom of the screen */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur border-t border-[#E2E0DB]">
        <div className="px-4 sm:px-8 py-3 flex items-center gap-3 flex-wrap">
          <span className="text-[10px] tracking-[0.12em] text-[#6B6B6B]">THE LOOK</span>
          <div className="flex items-center gap-1.5">
            {chosen.map((c) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={c.item_id} src={thumbUrl(c.image_url, 120)} alt={c.product_name} className="w-9 h-12 object-cover bg-[#F2F2F0]" />
            ))}
            {chosen.length === 0 && <span className="text-[10px] tracking-[0.09em] text-[#A8A8A4]">NOTHING PICKED YET</span>}
          </div>
          {createError && <span className="text-[10px] tracking-[0.09em] text-[#B83A3A]">{createError.toUpperCase()}</span>}
          <span className="flex items-center gap-2 ml-auto">
            <Link
              href={`/admin/composer?ask=${encodeURIComponent(ask)}`}
              className="text-[10px] tracking-[0.09em] px-4 py-2 border border-[#0A0A0A] text-[#4A4E57] hover:bg-[#0A0A0A] hover:text-white transition-colors"
            >
              COMPOSE LOOKS FROM THIS →
            </Link>
            <button
              type="button"
              onClick={create}
              disabled={creating || chosen.length === 0}
              className="text-[10px] tracking-[0.09em] px-4 py-2 bg-[#0A0A0A] text-white hover:bg-[#333] transition-colors disabled:opacity-40"
            >
              {creating ? 'CREATING…' : `CREATE OUTFIT → (${chosen.length})`}
            </button>
          </span>
        </div>
      </div>
    </div>
  )
}
