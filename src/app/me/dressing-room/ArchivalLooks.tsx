'use client'

// ARCHIVAL LOOKS — photos of what she already wears, from her Instagram or
// uploaded. Only photos with an outfit in them are kept, and they wait for
// her: she selects the ones worth keeping and adds them to her archival looks.
// Only then does MYRA look for the pieces, offered underneath; only the ones
// she taps go onto her rail.

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import FallbackImage from '@/components/FallbackImage'
import InstagramImport from './InstagramImport'
import MatchPanel from './MatchPanel'
import {
  addArchivalPiece, chooseMyArchivalLooks, dismissArchivalPiece, disconnectArchivalInstagram, loadArchivalPanel, nudgeArchival, removeArchivalLook,
  syncArchivalInstagram, uploadArchivalPhoto,
  type ArchivalPanelView,
} from './archival-actions'

const T = 'text-[20px] xl:text-[23px] 2xl:text-[27px]'
const T_SMALL = 'text-[18px] xl:text-[21px] 2xl:text-[25px]'
const WORKING = new Set(['detected', 'cutout_queued', 'cutout_running', 'scoring'])

export default function ArchivalLooks({ testMemberId }: { testMemberId?: string }) {
  const router = useRouter()
  const [view, setView] = useState<ArchivalPanelView | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState<string[]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  // The guided import reopens where she left it: step two can take a day.
  const [importing, setImporting] = useState(false)
  // FIND PIECES LIKE THIS — one of her looks, or a picture she uploads.
  const [matching, setMatching] = useState<{ kind: 'archival' | 'upload'; id?: string; imageUrl?: string | null } | null>(null)
  const polling = useRef(false)
  // Photos she has ticked to keep as archival looks.
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const togglePick = (id: string) => setPicked((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n })

  // The cross takes the photo away at once; the server catches up behind it.
  function removeLook(lookId: string) {
    setView((v) => (v ? { ...v, looks: v.looks.filter((l) => l.look_id !== lookId) } : v))
    setPicked((cur) => { const n = new Set(cur); n.delete(lookId); return n })
    void removeArchivalLook(lookId, testMemberId).then((r) => { if (r?.error) { setMsg(r.error); void refresh() } }).catch(() => void refresh())
  }

  async function keepPicked() {
    const ids = Array.from(picked)
    if (!ids.length) return
    await run('choose', async () => {
      // Move them across straight away: they are now being looked at.
      setView((v) => (v ? { ...v, looks: v.looks.map((l) => (picked.has(l.look_id) ? { ...l, photo_status: 'detecting' } : l)) } : v))
      setPicked(new Set())
      const r = await chooseMyArchivalLooks(ids, testMemberId)
      setMsg(r.error ?? `${r.chosen ?? ids.length} added to your archival looks. MYRA is finding the pieces in them.`)
      await refresh()
    })
  }

  const refresh = async () => setView(await loadArchivalPanel(testMemberId))
  const working = (k: string) => busy.includes(k)
  const run = async (k: string, fn: () => Promise<void>) => { setBusy((b) => [...b, k]); try { await fn() } finally { setBusy((b) => b.filter((x) => x !== k)) } }

  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(`myra_ig_import_${testMemberId ?? 'me'}`))
      if (saved === 2 || saved === 3) setImporting(true)
    } catch { /* private window */ }
  }, [testMemberId])

  useEffect(() => {
    void refresh()
    const q = new URLSearchParams(window.location.search)
    if (q.get('instagram_connected')) { setMsg('Instagram connected — bringing in your photos.'); void sync() }
    const err = q.get('instagram_error')
    if (err) setMsg(err)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testMemberId])

  // While MYRA is still looking at photos, keep the work moving and the section fresh.
  const processing = !!view?.looks.some((l) => l.photo_status === 'detecting' || l.pieces.some((p) => WORKING.has(p.status)))
  useEffect(() => {
    if (!processing || polling.current) return
    let live = true
    polling.current = true
    const tick = async () => {
      while (live) {
        await nudgeArchival(testMemberId).catch(() => ({ remaining: 0 }))
        if (!live) break
        const v = await loadArchivalPanel(testMemberId)
        setView(v)
        const still = v.looks.some((l) => l.photo_status === 'detecting' || l.pieces.some((p) => WORKING.has(p.status)))
        if (!still) break
        await new Promise((r) => setTimeout(r, 3000))
      }
      polling.current = false
    }
    void tick()
    return () => { live = false; polling.current = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processing, testMemberId])

  async function sync() {
    await run('sync', async () => {
      setMsg('Looking through your Instagram…')
      const r = await syncArchivalInstagram(testMemberId)
      setMsg(r.error ? r.error : r.added ? `${r.added} new photo${r.added === 1 ? '' : 's'} in — MYRA is looking at them.` : 'Nothing new on Instagram since last time.')
      await refresh()
    })
  }

  async function upload(files: FileList | null) {
    const list = Array.from(files ?? []).filter((f) => f.type.startsWith('image/')).slice(0, 24)
    if (!list.length) return
    await run('upload', async () => {
      let added = 0, failed = 0, noOutfit = 0
      for (let i = 0; i < list.length; i++) {
        setMsg(`Adding photo ${i + 1} of ${list.length}…`)
        const fd = new FormData()
        fd.set('file', list[i])
        if (testMemberId) fd.set('member', testMemberId)
        const r = await uploadArchivalPhoto(fd)
        if (r.error) failed++
        else if (r.noOutfit) noOutfit++
        else if (!r.skipped) added++
      }
      setMsg(`${added} photo${added === 1 ? '' : 's'} added${noOutfit ? ` · ${noOutfit} left out (no outfit in them)` : ''}${failed ? ` · ${failed} could not be read` : ''}.${added ? ' Select the ones to keep below.' : ''}`)
      if (fileRef.current) fileRef.current.value = ''
      await refresh()
    })
  }

  // While it loads, the section still stands — an empty space here reads as a
  // missing feature, and this is how she gets her own photos in.
  if (!view) {
    return (
      <section id="archival-looks" className="w-full rounded-[18px] bg-white/85 shadow-[0_2px_14px_rgba(43,43,43,0.08)] px-5 md:px-8 py-7 scroll-mt-6">
        <h2 className="text-[26px] xl:text-[29px] 2xl:text-[33px] tracking-[0.06em] text-[#2B2B2B]">ARCHIVAL LOOKS</h2>
        <p className={`${T} text-[#6E6B65] mt-2`}>Looking for your photos…</p>
      </section>
    )
  }
  if (!view.memberId) return null
  const returnPath = typeof window !== 'undefined' ? window.location.pathname : '/me/dressing-room'
  const igHref = `/api/instagram/start?return=${encodeURIComponent(returnPath)}${testMemberId ? `&member=${testMemberId}` : ''}`
  const connected = view.connections.filter((c) => c.status !== 'disconnected')
  // Kept but not yet chosen: waiting for her to pick. Everything else is an archival look.
  const waiting = view.looks.filter((l) => l.photo_status === 'uploaded')
  const chosen = view.looks.filter((l) => l.photo_status !== 'uploaded')

  return (
    <section id="archival-looks" className="w-full rounded-[18px] bg-white/85 shadow-[0_2px_14px_rgba(43,43,43,0.08)] px-5 md:px-8 py-7 space-y-6 scroll-mt-6">
      <div className="space-y-2">
        <h2 className="text-[26px] xl:text-[29px] 2xl:text-[33px] tracking-[0.06em] text-[#2B2B2B]">ARCHIVAL LOOKS</h2>
        <p className={`${T} text-[#4A4E57] max-w-4xl`}>
          Photos of what you already wear. MYRA keeps them here to learn how you put things together — and picks out the pieces, so you can add the ones you still own to your wardrobe.
        </p>
      </div>

      {view.error && <p className={`${T} text-[#B83A3A]`}>{view.error}</p>}
      {msg && <p className={`${T} text-[#2B2B2B]`}>{msg}</p>}

      {connected.map((c) => (
        <div key={c.connection_id} className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <p className={`${T} text-[#2B2B2B]`}>Instagram{c.username ? ` · @${c.username}` : ''}{c.status === 'error' && c.error ? <span className="text-[#B83A3A]"> — {c.error}</span> : null}</p>
          <button disabled={working('sync')} onClick={sync} className={`${T_SMALL} underline underline-offset-4 text-[#2B2B2B] disabled:opacity-40`}>{working('sync') ? 'Looking…' : 'Bring in new photos'}</button>
          <button onClick={() => run(`dc-${c.connection_id}`, async () => { await disconnectArchivalInstagram(c.connection_id, testMemberId); await refresh() })} className={`${T_SMALL} underline underline-offset-4 text-[#6E6B65]`}>Disconnect</button>
        </div>
      ))}

      {/* Three ways in. The import works for every account; one-tap connect only
          exists for Creator and Business accounts, so it shows only when it can work. */}
      {(
        <>
          <div className="flex flex-wrap gap-3">
            <button onClick={() => setImporting(true)} className="text-[22px] xl:text-[25px] 2xl:text-[29px] px-7 py-3.5 bg-[#2B2B2B] text-white rounded-full">
              Import from Instagram
            </button>
            <button disabled={working('upload')} onClick={() => fileRef.current?.click()} className="text-[22px] xl:text-[25px] 2xl:text-[29px] px-7 py-3.5 border border-[#2B2B2B] text-[#2B2B2B] rounded-full disabled:opacity-40">
              {working('upload') ? 'Adding…' : 'Add photos'}
            </button>
            {!connected.length && view.instagramReady && (
              <a href={igHref} className="text-[22px] xl:text-[25px] 2xl:text-[29px] px-7 py-3.5 border border-[#2B2B2B] text-[#2B2B2B] rounded-full">Connect a Creator or Business account</a>
            )}
            <button onClick={() => setMatching({ kind: 'upload' })} className="text-[22px] xl:text-[25px] 2xl:text-[29px] px-7 py-3.5 border border-[#2B2B2B] text-[#2B2B2B] rounded-full">
              Find pieces like a picture
            </button>
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => upload(e.target.files)} />
          </div>
          <p className={`${T_SMALL} text-[#6E6B65] max-w-4xl`}>
            <b>Import from Instagram</b> works for every account: MYRA walks you through asking Instagram for your photos, step by step. <b>Add photos</b> takes pictures straight from your computer or phone.
          </p>
        </>
      )}

      {matching && (
        <MatchPanel
          testMemberId={testMemberId}
          source={matching.kind === 'upload' ? { kind: 'upload' } : { kind: 'archival', id: matching.id!, imageUrl: matching.imageUrl }}
          onClose={() => setMatching(null)}
        />
      )}

      {importing && (
        <InstagramImport
          testMemberId={testMemberId}
          onClose={() => setImporting(false)}
          onImported={() => { void refresh() }}
        />
      )}

      {waiting.length > 0 && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className={`${T} text-[#2B2B2B]`}>Your photos: pick the outfits to keep</h3>
              <p className={`${T_SMALL} text-[#6E6B65]`}>MYRA only looks for the pieces in the ones you add.</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => setPicked(picked.size === waiting.length ? new Set() : new Set(waiting.map((l) => l.look_id)))}
                className={`${T_SMALL} px-5 py-2.5 rounded-full bg-white text-[#2B2B2B] shadow-[0_8px_18px_-12px_rgba(43,43,43,0.5)]`}>
                {picked.size === waiting.length ? 'Clear' : 'Select all'}
              </button>
              <button type="button" disabled={!picked.size || working('choose')} onClick={keepPicked}
                className={`myra-silver-button !w-auto px-7 !py-3 ${T_SMALL} disabled:opacity-40 disabled:pointer-events-none`}>
                {working('choose') ? 'Adding…' : picked.size ? `Add ${picked.size} to archival looks` : 'Add to archival looks'}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 min-[2200px]:grid-cols-5 gap-5">
            {waiting.map((l) => {
              const on = picked.has(l.look_id)
              return (
                <article key={l.look_id} className="flex flex-col gap-3">
                  <button type="button" onClick={() => togglePick(l.look_id)} aria-pressed={on}
                    className={`relative aspect-[3/4] bg-[#F3F2F0] overflow-hidden rounded-[16px] transition-shadow ${on ? 'ring-4 ring-[#2B2B2B] ring-offset-2' : ''}`}>
                    {l.image_url && <FallbackImage src={l.image_url} thumbWidth={800} alt="" className="absolute inset-0 w-full h-full object-cover" />}
                    {on && <span className="absolute top-3 left-3 w-10 h-10 rounded-full bg-[#2B2B2B] text-white grid place-content-center text-[22px]">✓</span>}
                  </button>
                  <div className="flex items-center justify-between gap-2">
                    <button type="button" onClick={() => togglePick(l.look_id)}
                      className={`${T_SMALL} px-5 py-2 rounded-full transition-colors ${on ? 'bg-[#2B2B2B] text-white' : 'bg-white text-[#2B2B2B] shadow-[0_8px_18px_-12px_rgba(43,43,43,0.5)]'}`}>
                      {on ? 'Selected' : 'Select'}
                    </button>
                    <button type="button" onClick={() => removeLook(l.look_id)} aria-label="Remove this photo"
                      className={`${T_SMALL} px-4 py-2 rounded-full text-[#6E6B65] hover:text-[#2B2B2B]`}>Remove</button>
                  </div>
                </article>
              )
            })}
          </div>
        </div>
      )}

      {chosen.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 min-[2200px]:grid-cols-5 gap-5">
          {chosen.map((l) => {
            const looking = l.photo_status === 'detecting' || l.pieces.some((p) => WORKING.has(p.status))
            const offered = l.pieces.filter((p) => p.status === 'review' || p.status === 'approved' || WORKING.has(p.status))
            return (
              <article key={l.look_id} className="bg-white rounded-[16px] overflow-hidden shadow-[0_1px_8px_rgba(43,43,43,0.06)] flex flex-col">
                <div className="relative aspect-[3/4] bg-[#F3F2F0] overflow-hidden">
                  {l.image_url && <FallbackImage src={l.image_url} thumbWidth={800} alt="" className="absolute inset-0 w-full h-full object-cover" />}
                  <button onClick={() => removeLook(l.look_id)} aria-label="Remove this photo" className="absolute top-3 right-3 w-10 h-10 rounded-full bg-[rgba(255,255,255,0.9)] text-[22px] leading-none text-[#2B2B2B]">×</button>
                </div>
                <div className="px-4 py-4 space-y-3">
                  {l.summary && <p className={`${T_SMALL} text-[#4A4E57] leading-snug`}>{l.summary}</p>}
                  <button type="button" onClick={() => setMatching({ kind: 'archival', id: l.look_id, imageUrl: l.image_url })}
                    className={`${T_SMALL} px-5 py-2 rounded-full bg-white text-[#2B2B2B] shadow-[0_8px_18px_-12px_rgba(43,43,43,0.5)]`}>
                    Find pieces like this
                  </button>
                  {looking && <p className={`${T_SMALL} text-[#6E6B65]`}>MYRA is looking at this one…</p>}
                  {!looking && !offered.length && <p className={`${T_SMALL} text-[#6E6B65]`}>{l.photo_status === 'no_garments' ? 'No pieces MYRA could pick out here.' : l.photo_status === 'failed' ? 'MYRA could not read this photo.' : 'Kept as a look.'}</p>}
                  {offered.map((p) => (
                    <div key={p.extraction_id} className="flex items-center gap-3">
                      <div className="relative w-14 h-[74px] xl:w-16 xl:h-[86px] bg-[#F3F2F0] rounded-[10px] overflow-hidden shrink-0">
                        {p.image_url && <FallbackImage src={p.image_url} thumbWidth={200} alt={p.name} className="absolute inset-0 w-full h-full object-contain" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className={`${T_SMALL} text-[#2B2B2B] leading-tight line-clamp-2`}>{p.name}</p>
                        {p.status === 'approved' ? (
                          <p className={`${T_SMALL} text-[#6E6B65]`}>In your wardrobe</p>
                        ) : p.status === 'review' ? (
                          <div className="flex gap-4 mt-1">
                            <button disabled={working(p.extraction_id)} onClick={() => run(p.extraction_id, async () => { const r = await addArchivalPiece(p.extraction_id, testMemberId); setMsg(r.error ?? `${p.name} is on your rail.`); await refresh(); if (!r.error) router.refresh() })} className={`${T_SMALL} underline underline-offset-4 text-[#2B2B2B] disabled:opacity-40`}>{working(p.extraction_id) ? 'Adding…' : 'Add to wardrobe'}</button>
                            <button disabled={working(p.extraction_id)} onClick={() => run(p.extraction_id, async () => { await dismissArchivalPiece(p.extraction_id, testMemberId); await refresh() })} className={`${T_SMALL} underline underline-offset-4 text-[#6E6B65] disabled:opacity-40`}>Not mine now</button>
                          </div>
                        ) : (
                          <p className={`${T_SMALL} text-[#6E6B65]`}>Cutting it out…</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
