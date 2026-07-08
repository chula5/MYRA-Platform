'use client'

import { useMemo, useState } from 'react'
import { thumbUrl } from '@/lib/image-utils'
import type { OutfitWithItems } from '@/types/database'
import { buildOutfitVector, cosine } from '@/lib/taste-vector'
import { rescoreOutfitFromImage } from './actions'

// Human labels for each of the 34 vector dimensions (order matches
// buildOutfitVector) — so hovering a bar tells you what it measures.
const DIM_LABELS = [
  'garment structure', 'print / pattern', 'layering', 'dressiness (shoe+bag)',
  'construction', 'surface story', 'volume', 'colour story', 'intent / statement',
  'brand price tier', 'brand era', 'brand aesthetic', 'cultural legibility', 'brand creativity',
  'neutral ratio', 'black', 'white / cream', 'navy / blue', 'brown / camel', 'green', 'warm / bold', 'multicolour',
  'dress', 'trousers', 'skirt', 'tailoring', 'knit / casual', 'shoe style', 'jewellery scale', 'bag formality',
  'material formality', 'material weight', 'occasion breadth', 'shoe formality',
]

const F_LABEL = ['', 'CASUAL', 'RELAXED', 'SMART', 'OCCASION', 'BLACK TIE']
const TOD_LABEL = ['', 'DAYTIME', 'DAY', 'DAY/EVE', 'EVENING', 'NIGHT']

function isUnscored(o: any): boolean {
  return o.formality === 3 && o.planning === 3 && o.wearer_priority === 3 && o.time_of_day === 3
}

function Fingerprint({ vec }: { vec: number[] }) {
  return (
    <div className="flex items-end gap-[1px] h-7 mt-2" aria-label="taste vector">
      {vec.map((v, i) => (
        <div
          key={i}
          title={`${DIM_LABELS[i]}: ${(v * 100).toFixed(0)}`}
          className="flex-1 rounded-[1px]"
          style={{ height: `${Math.max(6, v * 100)}%`, background: `rgba(196,168,130,${0.35 + v * 0.65})` }}
        />
      ))}
    </div>
  )
}

export default function VectorsClient({
  outfits,
  unscoredCount,
}: {
  outfits: OutfitWithItems[]
  unscoredCount: number
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(0)
  const [failed, setFailed] = useState(0)
  const [finished, setFinished] = useState(false)

  // Vectors are pure functions of the outfit data — compute once.
  const vectors = useMemo(() => {
    const m = new Map<string, number[]>()
    for (const o of outfits) m.set(o.outfit_id, buildOutfitVector(o))
    return m
  }, [outfits])

  const selectedOutfit = outfits.find((o) => o.outfit_id === selected) ?? null

  const similar = useMemo(() => {
    if (!selectedOutfit) return []
    const sv = vectors.get(selectedOutfit.outfit_id)!
    return outfits
      .filter((o) => o.outfit_id !== selectedOutfit.outfit_id)
      .map((o) => ({ outfit: o, score: cosine(sv, vectors.get(o.outfit_id)!) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
  }, [selectedOutfit, outfits, vectors])

  async function runBackfill() {
    const queue = outfits.filter((o) => isUnscored(o)).map((o) => o.outfit_id)
    if (queue.length === 0) return
    setRunning(true)
    setDone(0)
    setFailed(0)
    setFinished(false)

    // Small concurrency pool to keep vision calls within rate limits.
    const POOL = 3
    let idx = 0
    async function worker() {
      while (idx < queue.length) {
        const id = queue[idx++]
        const res = await rescoreOutfitFromImage(id)
        if (res.error) setFailed((f) => f + 1)
        else setDone((d) => d + 1)
      }
    }
    await Promise.all(Array.from({ length: POOL }, worker))
    setRunning(false)
    setFinished(true)
  }

  const total = outfits.filter(isUnscored).length || unscoredCount

  return (
    <div>
      {/* Scoring status / backfill */}
      <div className="mb-8 border border-[#E2E0DB] rounded-[12px] bg-white p-4 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[11px] tracking-[0.1em] text-[#4A4E57]">
            IMAGE-VISION SCORING
          </p>
          <p className="text-[10px] tracking-[0.06em] text-[#A8A8A4] mt-1">
            {total > 0
              ? `${total} OUTFIT${total === 1 ? '' : 'S'} STILL DEFAULT FORMALITY/TIME-OF-DAY TO 3 — SCAN THEIR IMAGES TO SCORE PROPERLY.`
              : 'ALL OUTFITS HAVE BEEN IMAGE-SCORED. ✓'}
          </p>
          {(running || finished) && (
            <p className="text-[10px] tracking-[0.08em] text-[#C4A882] mt-2">
              {running ? 'SCANNING' : 'DONE'} · {done} SCORED{failed > 0 ? ` · ${failed} FAILED` : ''}
              {running ? ` / ${total}` : ''}
              {finished && ' — RELOAD TO SEE UPDATED VECTORS.'}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          {finished && (
            <button
              onClick={() => location.reload()}
              className="border border-[#0A0A0A] text-[#4A4E57] px-5 py-2.5 text-[10px] tracking-[0.14em] rounded-full hover:bg-[#0A0A0A] hover:text-white transition-colors"
            >
              RELOAD
            </button>
          )}
          {total > 0 && (
            <button
              onClick={runBackfill}
              disabled={running}
              className="bg-[#0A0A0A] text-white px-6 py-2.5 text-[10px] tracking-[0.16em] rounded-full hover:opacity-85 transition-opacity disabled:opacity-50"
            >
              {running ? 'SCANNING…' : 'SCAN IMAGES TO SCORE'}
            </button>
          )}
        </div>
      </div>

      {/* Selected outfit + nearest neighbours by cosine */}
      {selectedOutfit && (
        <div className="mb-10 border border-[#C4A882] rounded-[14px] bg-[#FBFAF7] p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[11px] tracking-[0.14em] text-[#4A4E57]">MOST SIMILAR BY VECTOR</p>
            <button onClick={() => setSelected(null)} className="text-[#A8A8A4] hover:text-[#0A0A0A] text-[18px] leading-none">×</button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {/* The anchor of the comparison */}
            <div>
              <div className="aspect-[3/4] rounded-[10px] overflow-hidden bg-[#EDEDED] ring-2 ring-[#C4A882]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={thumbUrl(selectedOutfit.image_url || '/placeholder-outfit.jpg', 600)} alt="" className="w-full h-full object-cover" />
              </div>
              <p className="text-[8px] tracking-[0.14em] text-[#C4A882] mt-1.5">THIS OUTFIT</p>
              <Scores o={selectedOutfit as any} />
            </div>
            {similar.slice(0, 4).map(({ outfit, score }) => (
              <button key={outfit.outfit_id} onClick={() => setSelected(outfit.outfit_id)} className="text-left group">
                <div className="aspect-[3/4] rounded-[10px] overflow-hidden bg-[#EDEDED]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={thumbUrl(outfit.image_url || '/placeholder-outfit.jpg', 600)} alt="" className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-500" />
                </div>
                <p className="text-[9px] tracking-[0.1em] text-[#4A4E57] mt-1.5">{(score * 100).toFixed(1)}% MATCH</p>
                <Scores o={outfit as any} />
              </button>
            ))}
          </div>
          {similar.length > 4 && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-4">
              {similar.slice(4, 8).map(({ outfit, score }) => (
                <button key={outfit.outfit_id} onClick={() => setSelected(outfit.outfit_id)} className="text-left group">
                  <div className="aspect-[3/4] rounded-[10px] overflow-hidden bg-[#EDEDED]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={thumbUrl(outfit.image_url || '/placeholder-outfit.jpg', 600)} alt="" className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-500" />
                  </div>
                  <p className="text-[9px] tracking-[0.1em] text-[#4A4E57] mt-1.5">{(score * 100).toFixed(1)}% MATCH</p>
                  <Scores o={outfit as any} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* All live outfits with their vector fingerprints */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-8">
        {outfits.map((o) => (
          <button
            key={o.outfit_id}
            onClick={() => { setSelected(o.outfit_id); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
            className={`text-left group ${selected === o.outfit_id ? 'opacity-60' : ''}`}
          >
            <div className="relative aspect-[3/4] rounded-[10px] overflow-hidden bg-[#EDEDED]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={thumbUrl(o.image_url || '/placeholder-outfit.jpg', 600)} alt="" className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-500" />
              {isUnscored(o) && (
                <span className="absolute top-1.5 left-1.5 bg-[#B83A3A] text-white text-[7px] tracking-[0.1em] px-1.5 py-0.5 rounded">UNSCORED</span>
              )}
            </div>
            <Scores o={o as any} />
            <Fingerprint vec={vectors.get(o.outfit_id)!} />
          </button>
        ))}
      </div>
    </div>
  )
}

function Scores({ o }: { o: any }) {
  return (
    <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[8px] tracking-[0.06em] text-[#6B6B6B]">
      <span title="formality">FORM {F_LABEL[o.formality] ?? o.formality}</span>
      <span title="time of day">· {TOD_LABEL[o.time_of_day] ?? o.time_of_day}</span>
      <span title="colour story">· COLOUR {o.colour_story}</span>
      <span title="intent / statement">· INTENT {o.intent}</span>
    </div>
  )
}
