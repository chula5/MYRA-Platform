'use client'

// BRANDS THE CLIENTS HAVE ASKED FOR.
//
// Sits above the member list because it is the one panel on this page that is
// about all of them at once, and because it is the only place unprompted demand
// surfaces. A name here was typed by a client into her own settings and matched
// nothing in MYRA's brand table — so today it influences nothing at all.
//
// Sorted by how many people asked, not by when: three clients naming the same
// brand is the argument for stocking it, and that is the number to lead with.
//
// CLEARING IS NOT STOCKING. This panel never touches watched_brand — adding a
// brand to the scanner costs a catalogue scrape and needs a storefront URL, so
// it stays a deliberate act in BRAND WATCH. Marking a request handled only says
// it has been decided, and the note records what was decided.

import { useEffect, useState } from 'react'
import { loadBrandRequests, handleBrandRequest, type BrandRequest } from './brand-request-actions'

export default function BrandRequests() {
  const [rows, setRows] = useState<BrandRequest[] | null>(null)
  const [available, setAvailable] = useState(true)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<string | null>(null)

  const load = async () => {
    const r = await loadBrandRequests()
    setAvailable(r.available)
    setRows(r.requests)
  }

  useEffect(() => { void load() }, [])

  // Nothing waiting is the normal state, and a heading that is always there
  // teaches Chloe to stop seeing it. It appears when there is something to do.
  if (!rows || (!rows.length && available)) return null

  return (
    <div className="border border-[#C4A882] px-5 py-4">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-between gap-4 w-full text-left"
      >
        <p className="text-[20px] tracking-[0.14em] text-[#C4A882]">
          {available
            ? `${rows.length} BRAND${rows.length === 1 ? '' : 'S'} YOUR CLIENTS HAVE ASKED FOR AND MYRA DOES NOT HAVE`
            : 'RUN 0064_CLIENT_BRAND_REQUESTS.SQL TO SEE WHAT CLIENTS HAVE ASKED FOR'}
        </p>
        {available && (
          <span className="text-[20px] tracking-[0.1em] text-[#6B6B6B] shrink-0">{open ? 'HIDE' : 'SHOW'}</span>
        )}
      </button>

      {available && open && (
        <div className="mt-4 space-y-3">
          <p className="text-[20px] tracking-[0.06em] text-[#6B6B6B] leading-relaxed">
            Each of these was typed by a client and matched nothing in the brand table, so it reaches
            none of her looks. Put it on the watchlist in BRAND WATCH (it needs the storefront URL),
            or clear it with what you decided.
          </p>

          {msg && <p className="text-[20px] tracking-[0.12em] text-[#C4A882]">{msg}</p>}

          {rows.map((r) => (
            <div key={r.name} className="flex items-center gap-3 flex-wrap border-t border-[#F2F2F0] pt-3">
              <p className="text-[20px] tracking-[0.08em] text-[#0A0A0A] min-w-[180px]">
                {r.name.toUpperCase()}
                {r.asks > 1 && <span className="text-[#C4A882]"> · ASKED {r.asks}×</span>}
              </p>
              <p className="text-[20px] tracking-[0.06em] text-[#6B6B6B] flex-1 min-w-[160px]">
                {r.members.length ? r.members.join(' · ').toUpperCase() : 'MEMBER NOT RECORDED'}
                {' · '}
                {new Date(r.lastAskedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).toUpperCase()}
              </p>
              <input
                className="border border-[#E2E0DB] px-3 py-1.5 text-[20px] tracking-[0.06em] text-[#0A0A0A] w-56"
                placeholder="WHAT YOU DECIDED"
                value={note[r.name] ?? ''}
                onChange={(e) => setNote((n) => ({ ...n, [r.name]: e.target.value }))}
              />
              <button
                disabled={busy === r.name}
                onClick={async () => {
                  setBusy(r.name)
                  setMsg(null)
                  const res = await handleBrandRequest(r.logIds, note[r.name] ?? '')
                  setBusy(null)
                  if (res.error) { setMsg(res.error.toUpperCase()); return }
                  setMsg(`${r.name.toUpperCase()} CLEARED`)
                  await load()
                }}
                className="text-[20px] tracking-[0.12em] text-[#0A0A0A] border border-[#0A0A0A] px-4 py-1.5 hover:bg-[#0A0A0A] hover:text-white transition-colors"
              >
                {busy === r.name ? 'CLEARING…' : 'CLEAR'}
              </button>
            </div>
          ))}

          <a
            href="/admin/brand-watch"
            className="inline-block text-[20px] tracking-[0.12em] text-[#6B6B6B] hover:text-[#0A0A0A] transition-colors pt-2"
          >
            OPEN BRAND WATCH →
          </a>
        </div>
      )}
    </div>
  )
}
