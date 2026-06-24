'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { addClip, updateClip, deleteClip, type ClipInput } from './actions'

export interface Clip {
  clip_id: string
  title: string
  caption: string | null
  video_url: string
  poster_url: string | null
  sort_order: number
}

// Suggested areas to capture — shown as quick-fill chips on the add form.
const SUGGESTED = [
  'Pick an occasion → outfits',
  'Source items → shop the look',
  'Similar looks → explore styles',
  'Swipe between looks',
  'Search by item, colour, brand',
]

// Render a video link as an mp4 player or a YouTube/Loom embed.
function VideoFrame({ url, poster }: { url: string; poster?: string | null }) {
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]+)/)
  const loom = url.match(/loom\.com\/(?:share|embed)\/([\w-]+)/)
  if (yt) {
    return (
      <iframe
        src={`https://www.youtube.com/embed/${yt[1]}`}
        className="w-full h-full"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    )
  }
  if (loom) {
    return (
      <iframe
        src={`https://www.loom.com/embed/${loom[1]}`}
        className="w-full h-full"
        allowFullScreen
      />
    )
  }
  return (
    <video
      src={url}
      poster={poster || undefined}
      controls
      playsInline
      preload="metadata"
      className="w-full h-full object-cover bg-black"
    />
  )
}

export default function ProductViewManager({ clips }: { clips: Clip[] }) {
  const router = useRouter()
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-[14px] tracking-[0.063em] text-[#4A4E57]">DEMO VIDEOS</h2>
          <p className="text-[11px] tracking-[0.059em] text-[#A8A8A4] mt-1 max-w-[560px] leading-relaxed">
            Optional saved clips. Screen-record a flow (or capture one of the previews above), host it
            (Cloudinary, Loom or a YouTube link), then add it here with a title and caption.
          </p>
        </div>
        {!adding && (
          <button
            onClick={() => { setAdding(true); setEditingId(null) }}
            className="bg-[#0A0A0A] text-white px-5 py-2.5 rounded-[12px] text-[10px] tracking-[0.09em] hover:opacity-85 transition-opacity"
          >
            + ADD VIDEO
          </button>
        )}
      </div>

      {adding && (
        <ClipForm
          onCancel={() => setAdding(false)}
          onSave={async (input) => {
            const res = await addClip(input)
            if (!res.error) { setAdding(false); router.refresh() }
            return res
          }}
          defaultSort={clips.length}
        />
      )}

      {clips.length === 0 && !adding && (
        <p className="text-[11px] tracking-[0.09em] text-[#A8A8A4] py-16 text-center">
          NO VIDEOS YET — ADD YOUR FIRST DEMO ABOVE.
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mt-8">
        {clips.map((clip) =>
          editingId === clip.clip_id ? (
            <div key={clip.clip_id} className="lg:col-span-2">
              <ClipForm
                initial={clip}
                onCancel={() => setEditingId(null)}
                onSave={async (input) => {
                  const res = await updateClip(clip.clip_id, input)
                  if (!res.error) { setEditingId(null); router.refresh() }
                  return res
                }}
                defaultSort={clip.sort_order}
              />
            </div>
          ) : (
            <ShowcaseCard
              key={clip.clip_id}
              clip={clip}
              onEdit={() => { setEditingId(clip.clip_id); setAdding(false) }}
              onDelete={async () => {
                if (!confirm('Delete this video?')) return
                await deleteClip(clip.clip_id)
                router.refresh()
              }}
            />
          ),
        )}
      </div>
    </div>
  )
}

// ── Polished showcase card (matches the marketing-style look) ──
function ShowcaseCard({ clip, onEdit, onDelete }: { clip: Clip; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="bg-white rounded-[18px] p-3 sm:p-4 shadow-[0_30px_60px_-28px_rgba(0,0,0,0.35)] border border-[#EFEDE8]">
      {/* Top bar — decorative dots + area label */}
      <div className="flex items-center justify-between px-2 pt-1 pb-3">
        <div className="flex items-center gap-1.5">
          <span className="w-5 h-1.5 rounded-full bg-[#0A0A0A]" />
          <span className="w-1.5 h-1.5 rounded-full bg-[#D8D6D1]" />
          <span className="w-1.5 h-1.5 rounded-full bg-[#D8D6D1]" />
          <span className="w-1.5 h-1.5 rounded-full bg-[#D8D6D1]" />
        </div>
        {clip.caption && (
          <span className="text-[10px] tracking-[0.099em] text-[#4A4E57] uppercase">{clip.caption}</span>
        )}
      </div>

      {/* Video */}
      <div className="relative w-full aspect-[16/10] rounded-[12px] overflow-hidden bg-[#F2F2F2]">
        <VideoFrame url={clip.video_url} poster={clip.poster_url} />
      </div>

      {/* Title + actions */}
      <div className="flex items-start justify-between gap-3 px-1 pt-4">
        <h2 className="text-[20px] leading-tight text-[#4A4E57] tracking-[0.005em]" style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>
          {clip.title}
        </h2>
        <div className="flex gap-2 flex-shrink-0 pt-1">
          <button onClick={onEdit} className="text-[9px] tracking-[0.072em] text-[#6B6B6B] hover:text-[#4A4E57] border border-[#E2E0DB] hover:border-[#0A0A0A] px-3 py-1.5 rounded-[12px] transition-colors">EDIT</button>
          <button onClick={onDelete} className="text-[9px] tracking-[0.072em] text-[#A8A8A4] hover:text-[#B83A3A] border border-[#E2E0DB] hover:border-[#B83A3A] px-3 py-1.5 rounded-[12px] transition-colors">DELETE</button>
        </div>
      </div>
    </div>
  )
}

// ── Add / edit form ──
function ClipForm({
  initial,
  onSave,
  onCancel,
  defaultSort,
}: {
  initial?: Clip
  onSave: (input: ClipInput) => Promise<{ error?: string }>
  onCancel: () => void
  defaultSort: number
}) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [caption, setCaption] = useState(initial?.caption ?? '')
  const [videoUrl, setVideoUrl] = useState(initial?.video_url ?? '')
  const [posterUrl, setPosterUrl] = useState(initial?.poster_url ?? '')
  const [sortOrder, setSortOrder] = useState(initial?.sort_order ?? defaultSort)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const input = 'w-full border border-[#E2E0DB] bg-white px-4 py-2.5 text-[12px] tracking-[0.027em] text-[#4A4E57] placeholder:text-[#A8A8A4] focus:outline-none focus:border-[#0A0A0A] transition-colors'

  async function save() {
    setSaving(true)
    setError(null)
    const res = await onSave({ title, caption, videoUrl, posterUrl, sortOrder })
    setSaving(false)
    if (res.error) setError(res.error)
  }

  return (
    <div className="border border-[#E2E0DB] bg-[#FAFAF8] rounded-[14px] p-6 mb-2">
      <p className="text-[10px] tracking-[0.099em] text-[#6B6B6B] mb-4">{initial ? 'EDIT VIDEO' : 'NEW VIDEO'}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-[820px]">
        <div className="sm:col-span-2">
          <label className="text-[9px] tracking-[0.081em] text-[#A8A8A4] block mb-1">TITLE</label>
          <input className={input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Pick an occasion, see the looks" />
          {!initial && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {SUGGESTED.map((s) => (
                <button key={s} type="button" onClick={() => setTitle(s)} className="text-[9px] tracking-[0.045em] text-[#6B6B6B] border border-[#E2E0DB] hover:border-[#0A0A0A] px-2 py-1 rounded-[12px] transition-colors">
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="sm:col-span-2">
          <label className="text-[9px] tracking-[0.081em] text-[#A8A8A4] block mb-1">AREA LABEL (small caps, top-right of card)</label>
          <input className={input} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="e.g. THE EDIT · OCCASIONS" />
        </div>
        <div className="sm:col-span-2">
          <label className="text-[9px] tracking-[0.081em] text-[#A8A8A4] block mb-1">VIDEO LINK (mp4 / Cloudinary / YouTube / Loom)</label>
          <input className={input} value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="https://res.cloudinary.com/.../demo.mp4" />
        </div>
        <div>
          <label className="text-[9px] tracking-[0.081em] text-[#A8A8A4] block mb-1">POSTER IMAGE (optional)</label>
          <input className={input} value={posterUrl} onChange={(e) => setPosterUrl(e.target.value)} placeholder="https://.../thumbnail.jpg" />
        </div>
        <div>
          <label className="text-[9px] tracking-[0.081em] text-[#A8A8A4] block mb-1">ORDER</label>
          <input type="number" className={input} value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))} />
        </div>
      </div>

      {error && <p className="text-[10px] tracking-[0.054em] text-[#B83A3A] mt-3">{error}</p>}

      <div className="flex gap-3 mt-5">
        <button onClick={save} disabled={saving} className="bg-[#0A0A0A] text-white px-6 py-2.5 rounded-[12px] text-[10px] tracking-[0.09em] hover:opacity-85 transition-opacity disabled:opacity-50">
          {saving ? 'SAVING…' : initial ? 'SAVE CHANGES' : 'ADD VIDEO'}
        </button>
        <button onClick={onCancel} className="text-[10px] tracking-[0.09em] text-[#6B6B6B] hover:text-[#4A4E57] px-4 transition-colors">CANCEL</button>
      </div>
    </div>
  )
}
