'use client'

// BUILD ONE YOURSELF.
//
// Two rails — what she owns and what she has saved — and a space above them to
// put pieces on. Tap to add, tap again to take off. The note from MYRA sits
// with the outfit and changes as she changes it, because it is computed here
// rather than fetched: the rules are pure, so there is nothing to wait for.
//
// THE NOTE IS SHORT ON PURPOSE. She chose these pieces; a paragraph explaining
// why she is wrong is not what she came for. When MYRA is unsure it says the
// one thing that is off and lights up the pieces SHE ALREADY HAS that would
// settle it — never a catalogue, because she asked whether these work, not to
// be sold something.

import { useEffect, useMemo, useState } from 'react'
import {
  loadMyBuildShelves, saveMyOutfit, deleteMyOutfit,
  type BuildPiece, type BuildShelves, type SavedBuild,
} from '@/app/me/build-actions'
import { readOutfit, piecesThatWouldHelp, type OutfitRead } from '@/lib/outfit-read'
import { OCCASION_TYPES } from '@/lib/pilot-stylist'
import { MirrorLoading } from '@/components/ArchiveCard'

const card = 'rounded-[28px] bg-white/80 shadow-[0_18px_40px_-24px_rgba(43,43,43,0.35)] p-6 sm:p-9'
const heading = 'text-[clamp(26px,1.7vw,40px)] text-[#2B2B2B]'
const label = 'text-[clamp(20px,1.1vw,28px)] text-[#55534E]'
const field = 'w-full rounded-full bg-white px-6 py-4 text-[clamp(20px,1.1vw,28px)] text-[#2B2B2B] shadow-[0_10px_18px_-12px_rgba(120,120,120,0.6)] outline-none border-2 border-transparent focus:border-[#C9C9C9]'
const quietPill = 'rounded-full px-5 py-2.5 text-[clamp(18px,1vw,24px)] transition-colors bg-white text-[#55534E] hover:text-[#2B2B2B] shadow-[0_8px_16px_-12px_rgba(120,120,120,0.7)]'

const keyOf = (p: { item_id: string }) => p.item_id

export default function OutfitBuilder({ testMemberId }: { testMemberId?: string }) {
  const [shelves, setShelves] = useState<BuildShelves | null | undefined>(undefined)
  const [chosen, setChosen] = useState<BuildPiece[]>([])
  const [name, setName] = useState('')
  const [occasion, setOccasion] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [shelf, setShelf] = useState<'wardrobe' | 'saved'>('wardrobe')

  useEffect(() => {
    let alive = true
    void loadMyBuildShelves(testMemberId).then((s) => { if (alive) setShelves(s) })
    return () => { alive = false }
  }, [testMemberId])

  // MYRA's read, recomputed as she moves pieces. Pure — no round trip.
  const read: OutfitRead = useMemo(
    () => readOutfit({ items: chosen, prefs: shelves?.prefs ?? null, occasion: occasion || null }),
    [chosen, shelves?.prefs, occasion],
  )

  const inOutfit = useMemo(() => new Set(chosen.map(keyOf)), [chosen])
  const rail = shelf === 'wardrobe' ? shelves?.wardrobe ?? [] : shelves?.saved ?? []
  const wouldHelp = useMemo(
    () => piecesThatWouldHelp(read, [...(shelves?.wardrobe ?? []), ...(shelves?.saved ?? [])], inOutfit),
    [read, shelves, inOutfit],
  )
  const helpIds = useMemo(() => new Set(wouldHelp.map(keyOf)), [wouldHelp])

  if (shelves === undefined) return <MirrorLoading label="OPENING YOUR PIECES" />
  if (shelves === null) return <p className={label}>Sign in to build an outfit.</p>

  const toggle = (p: BuildPiece) =>
    setChosen((cur) => (cur.some((c) => keyOf(c) === keyOf(p))
      ? cur.filter((c) => keyOf(c) !== keyOf(p))
      : cur.length >= 12 ? cur : [...cur, p]))

  async function save() {
    setBusy(true); setNote(null)
    const r = await saveMyOutfit({ pieces: chosen, name, occasion: occasion || null, verdict: read }, testMemberId)
    setBusy(false)
    if (r.error) { setNote(r.error); return }
    setChosen([]); setName(''); setOccasion('')
    setNote('Saved to your outfits.')
    const fresh = await loadMyBuildShelves(testMemberId)
    if (fresh) setShelves(fresh)
    setTimeout(() => setNote(null), 3000)
  }

  async function remove(outfitId: string) {
    if (!window.confirm('Remove this outfit? The pieces stay where they are.')) return
    const r = await deleteMyOutfit(outfitId, testMemberId)
    if (r.error) { setNote(r.error); return }
    const fresh = await loadMyBuildShelves(testMemberId)
    if (fresh) setShelves(fresh)
  }

  const nothingToBuildWith = !shelves.wardrobe.length && !shelves.saved.length

  return (
    <section className={`${card} lg:col-span-2`} data-tour="builder">
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <h2 className={heading}>Build an outfit</h2>
        <p className={label}>Your own pieces, and the ones you have saved.</p>
      </div>

      {nothingToBuildWith ? (
        <p className={`${label} myra-guide-text mt-6`}>
          Nothing to build with yet. Add pieces to your wardrobe, or save one from a look, and they
          will appear here.
        </p>
      ) : (
        <>
          {/* ── What she has put together ──────────────────────────────────── */}
          <div className="mt-7 rounded-[22px] bg-white/70 p-5 sm:p-6 min-h-[172px]">
            {chosen.length ? (
              <div className="flex flex-wrap gap-4">
                {chosen.map((p) => (
                  <button
                    key={keyOf(p)}
                    type="button"
                    onClick={() => toggle(p)}
                    className="group relative w-[clamp(88px,7vw,132px)] text-left"
                    title={`Take ${p.product_name ?? 'this'} off`}
                  >
                    <Thumb piece={p} />
                    <p className="mt-2 text-[clamp(15px,0.85vw,20px)] text-[#55534E] truncate">
                      {p.brand_name ?? (p.source === 'wardrobe' ? 'Yours' : '')}
                    </p>
                    <span className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-[#2B2B2B] text-white text-[16px] leading-[28px] text-center opacity-0 group-hover:opacity-100 transition-opacity">
                      ×
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className={`${label} myra-guide-text`}>Tap pieces below to put them together.</p>
            )}
          </div>

          {/* ── MYRA's line ────────────────────────────────────────────────── */}
          <div className="mt-5 flex items-start gap-3 flex-wrap">
            <span
              className="mt-[0.45em] w-2.5 h-2.5 rounded-full shrink-0"
              style={{ background: read.tone === 'good' ? '#2B2B2B' : read.tone === 'unsure' ? '#C4A882' : '#D9D9D6' }}
              aria-hidden
            />
            <p className="myra-guide-text text-[clamp(21px,1.15vw,30px)] text-[#2B2B2B] flex-1 min-w-[16ch]">
              {read.line}
            </p>
          </div>

          {/* Her own pieces that would settle it. Only when MYRA is unsure. */}
          {wouldHelp.length > 0 && (
            <p className={`${label} myra-guide-text mt-2`}>
              Try {read.wants?.why} — the ones that would work are marked below.
            </p>
          )}

          {/* ── Name it and keep it ────────────────────────────────────────── */}
          {chosen.length >= 2 && (
            <div className="mt-6 flex gap-3 flex-wrap sm:flex-nowrap items-center">
              <input
                className={field}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Call it something (optional)"
                aria-label="Name this outfit"
              />
              <select
                className={`${field} !w-auto !px-5`}
                value={occasion}
                onChange={(e) => setOccasion(e.target.value)}
                aria-label="What is it for"
              >
                <option value="">What for…</option>
                {OCCASION_TYPES.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
              <button
                type="button"
                onClick={save}
                disabled={busy}
                className={`shrink-0 rounded-full px-9 py-4 text-[clamp(20px,1.1vw,28px)] transition-all ${
                  busy ? 'bg-white/70 text-[#A8A8A4]' : 'bg-[#2B2B2B] text-white hover:scale-[1.03]'
                }`}
              >
                {busy ? 'Saving…' : 'Keep it'}
              </button>
            </div>
          )}

          {note && <p className={`${label} myra-guide-text mt-4`}>{note}</p>}

          {/* ── The rails ──────────────────────────────────────────────────── */}
          <div className="mt-8 flex gap-2.5">
            <button
              type="button"
              onClick={() => setShelf('wardrobe')}
              className={shelf === 'wardrobe'
                ? 'rounded-full px-5 py-2.5 text-[clamp(18px,1vw,24px)] bg-[#2B2B2B] text-white'
                : quietPill}
            >
              Your wardrobe · {shelves.wardrobe.length}
            </button>
            <button
              type="button"
              onClick={() => setShelf('saved')}
              className={shelf === 'saved'
                ? 'rounded-full px-5 py-2.5 text-[clamp(18px,1vw,24px)] bg-[#2B2B2B] text-white'
                : quietPill}
            >
              Saved pieces · {shelves.saved.length}
            </button>
          </div>

          <div className="mt-5 grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-4">
            {rail.map((p) => {
              const on = inOutfit.has(keyOf(p))
              const helps = helpIds.has(keyOf(p))
              return (
                <button
                  key={keyOf(p)}
                  type="button"
                  onClick={() => toggle(p)}
                  aria-pressed={on}
                  className="text-left"
                  title={p.product_name ?? undefined}
                >
                  <Thumb piece={p} on={on} helps={helps} />
                  <p className="mt-2 text-[clamp(15px,0.85vw,20px)] text-[#55534E] truncate">
                    {p.brand_name ?? (p.source === 'wardrobe' ? 'Yours' : '')}
                  </p>
                </button>
              )
            })}
            {!rail.length && (
              <p className={`${label} myra-guide-text col-span-full`}>
                {shelf === 'wardrobe'
                  ? 'No pieces in your wardrobe yet.'
                  : 'Nothing saved yet — tap the heart on a piece in one of your looks.'}
              </p>
            )}
          </div>
        </>
      )}

      {/* ── What she has already built ───────────────────────────────────── */}
      {shelves.builds.length > 0 && (
        <div className="mt-10">
          <h3 className={heading}>Outfits you made</h3>
          <div className="mt-5 space-y-5">
            {shelves.builds.map((b) => <Built key={b.outfitId} build={b} onRemove={() => remove(b.outfitId)} />)}
          </div>
        </div>
      )}

      {!shelves.available && (
        <p className={`${label} myra-guide-text mt-6`}>
          You can try pieces together now, but keeping an outfit is not switched on yet.
        </p>
      )}
    </section>
  )
}

/** A piece on the rail. Marked when it is in the outfit, and marked differently
 *  when it is one MYRA thinks would settle what is off. */
function Thumb({ piece, on, helps }: { piece: BuildPiece; on?: boolean; helps?: boolean }) {
  return (
    <div
      className={`aspect-[3/4] rounded-[16px] overflow-hidden bg-white transition-all ${
        on ? 'ring-[3px] ring-[#2B2B2B]' : helps ? 'ring-[3px] ring-[#C4A882]' : 'ring-1 ring-[#EDEDEA]'
      }`}
    >
      {piece.image_url
        ? <img src={piece.image_url} alt={piece.product_name ?? ''} className="w-full h-full object-cover" loading="lazy" />
        : <span className="flex items-center justify-center w-full h-full text-[clamp(14px,0.8vw,18px)] text-[#A8A8A4] px-2 text-center">
            {piece.product_name ?? 'Piece'}
          </span>}
    </div>
  )
}

function Built({ build, onRemove }: { build: SavedBuild; onRemove: () => void }) {
  return (
    <div className="rounded-[22px] bg-white/70 p-5">
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <p className="text-[clamp(22px,1.2vw,30px)] text-[#2B2B2B]">
          {build.name || 'Untitled'}
          {build.occasion && (
            <span className="text-[#8A8F95]">
              {' · '}{OCCASION_TYPES.find((o) => o.id === build.occasion)?.label ?? build.occasion}
            </span>
          )}
        </p>
        <button type="button" onClick={onRemove} className={quietPill}>Remove</button>
      </div>
      {build.verdict?.line && (
        <p className="myra-guide-text text-[clamp(19px,1.05vw,26px)] text-[#55534E] mt-2">{build.verdict.line}</p>
      )}
      <div className="mt-4 flex flex-wrap gap-3">
        {build.pieces.map((p, i) => (
          <div key={`${p.item_id}-${i}`} className="w-[clamp(72px,5.5vw,104px)]">
            <Thumb piece={p as BuildPiece} />
          </div>
        ))}
      </div>
    </div>
  )
}
