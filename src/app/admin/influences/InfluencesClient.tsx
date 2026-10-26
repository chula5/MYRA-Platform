'use client'

// The people, as portrait cards; one open at a time below. Open a person to
// paste their pictures (⌘V anywhere), write the brief, choose the portrait and
// link the clients who named them.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import FallbackImage from '@/components/FallbackImage'
import {
  INFLUENCE_KINDS, linesToList,
  type InfluenceBrief, type InfluenceKind, type StyleInfluence,
} from '@/lib/style-influence'
import {
  createInfluence, updateInfluence, deleteInfluence, loadInfluenceImages, addInfluencePictures,
  removeInfluenceImage, linkInfluenceMember, unlinkInfluenceMember, type InfluenceImageView,
} from './actions'

export interface InfluenceRow extends StyleInfluence {
  pictures: number
  scored: number
  members: { member_id: string; name: string; source: string }[]
}

const LABEL = 'text-[10px] tracking-[0.12em] text-[#6B6B6B]'
const FIELD = 'w-full border border-[#E2E0DB] px-3 py-2 text-[14px] text-[#2B2B2B] outline-none focus:border-[#0A0A0A] bg-white'
const BTN = 'border border-[#0A0A0A] px-4 py-2 text-[11px] tracking-[0.1em] text-[#0A0A0A] hover:bg-[#0A0A0A] hover:text-white disabled:opacity-40'
const DARK = 'bg-[#0A0A0A] text-white px-4 py-2 text-[11px] tracking-[0.1em] hover:opacity-85 disabled:opacity-40'

export default function InfluencesClient({ rows, members }: { rows: InfluenceRow[]; members: { member_id: string; name: string }[] }) {
  const router = useRouter()
  const [openId, setOpenId] = useState<string | null>(rows[0]?.influence_id ?? null)
  const [newName, setNewName] = useState('')
  const [newKind, setNewKind] = useState<InfluenceKind>('celebrity')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const open = rows.find((r) => r.influence_id === openId) ?? null

  async function add() {
    setBusy(true)
    const r = await createInfluence(newName, newKind)
    setBusy(false)
    if (r.error) { setMsg(r.error.toUpperCase()); return }
    setNewName('')
    setOpenId(r.id ?? null)
    router.refresh()
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <p className={LABEL}>ADD A PERSON</p>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void add() }}
            placeholder="e.g. Gillian Anderson" className={`${FIELD} w-[280px] mt-1`} />
        </div>
        <select value={newKind} onChange={(e) => setNewKind(e.target.value as InfluenceKind)} className={`${FIELD} w-[160px]`}>
          {INFLUENCE_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
        </select>
        <button disabled={busy || !newName.trim()} onClick={add} className={DARK}>ADD</button>
        {msg && <span className="text-[11px] tracking-[0.1em] text-[#7C838B]">{msg}</span>}
      </div>

      {rows.length === 0 ? (
        <p className="text-[13px] text-[#6B6B6B]">No one yet. Add the first person a client named.</p>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-8 gap-3">
          {rows.map((r) => (
            <button key={r.influence_id} onClick={() => setOpenId(r.influence_id)}
              className={`text-left rounded-[10px] overflow-hidden border ${openId === r.influence_id ? 'border-[#0A0A0A]' : 'border-[#E2E0DB] hover:border-[#A8A8A4]'}`}>
              <div className="aspect-[3/4] bg-[#F4F3F0] relative">
                {r.image_url && <FallbackImage src={r.image_url} thumbWidth={400} alt="" className="absolute inset-0 w-full h-full object-cover object-top" />}
                <span className={`absolute top-2 left-2 text-[9px] tracking-[0.12em] px-2 py-0.5 rounded-full ${r.status === 'live' ? 'bg-[#0A0A0A] text-white' : 'bg-white/90 text-[#6B6B6B]'}`}>
                  {r.status.toUpperCase()}
                </span>
              </div>
              <div className="px-2.5 py-2">
                <p className="text-[13px] text-[#2B2B2B] leading-tight">{r.name}</p>
                <p className="text-[10px] tracking-[0.08em] text-[#A8A8A4] mt-0.5">
                  {r.scored}/{r.pictures} PICS · {r.members.length} CLIENT{r.members.length === 1 ? '' : 'S'}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      {open && <InfluenceEditor key={open.influence_id} row={open} members={members} onDeleted={() => { setOpenId(null); router.refresh() }} />}
    </div>
  )
}

function InfluenceEditor({ row, members, onDeleted }: { row: InfluenceRow; members: { member_id: string; name: string }[]; onDeleted: () => void }) {
  const router = useRouter()
  const [name, setName] = useState(row.name)
  const [kind, setKind] = useState<InfluenceKind>(row.kind)
  const [handle, setHandle] = useState(row.handle ?? '')
  const [summary, setSummary] = useState(row.brief.summary)
  const [signatures, setSignatures] = useState(row.brief.signatures.join('\n'))
  const [silhouettes, setSilhouettes] = useState(row.brief.silhouettes.join('\n'))
  const [palette, setPalette] = useState(row.brief.palette.join('\n'))
  const [nevers, setNevers] = useState(row.brief.nevers.join('\n'))
  const [images, setImages] = useState<InfluenceImageView[]>([])
  const [links, setLinks] = useState('')
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [addMember, setAddMember] = useState('')

  const refresh = async () => setImages(await loadInfluenceImages(row.influence_id))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void refresh() }, [row.influence_id])

  async function run(key: string, fn: () => Promise<{ error?: string } & Record<string, any>>, ok: string | ((r: any) => string)) {
    setBusy(key)
    setMsg(null)
    const r = await fn()
    setBusy(null)
    setMsg(r?.error ? r.error.toUpperCase() : (typeof ok === 'string' ? ok : ok(r)))
    await refresh()
    router.refresh()
  }

  const imagesFrom = (list: DataTransferItemList | FileList | null | undefined): File[] => {
    if (!list) return []
    const out: File[] = []
    for (let i = 0; i < list.length; i++) {
      const it = list[i] as DataTransferItem | File
      const f = 'getAsFile' in it ? (it.kind === 'file' ? it.getAsFile() : null) : it
      if (f && f.type.startsWith('image/')) out.push(f)
    }
    return out
  }

  async function addPictures(files: File[], urls = '') {
    if (!files.length && !urls.trim()) return
    const fd = new FormData()
    fd.set('influenceId', row.influence_id)
    fd.set('urls', urls)
    for (const f of files) fd.append('files', f)
    setMsg(`READING ${files.length || 'THE'} PICTURE${files.length === 1 ? '' : 'S'}…`)
    await run('add', () => addInfluencePictures(fd), (r) => {
      setLinks('')
      return `${r.added} PICTURE${r.added === 1 ? '' : 'S'} ADDED AND SCORED${r.failed ? ` · ${r.failed} COULD NOT BE SAVED` : ''}`
    })
  }

  // ⌘V anywhere while a person is open: pasted pictures are theirs.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      const files = imagesFrom(e.clipboardData?.items)
      if (!files.length || busy) return
      e.preventDefault()
      void addPictures(files)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, row.influence_id])

  const brief: InfluenceBrief = {
    summary: summary.trim(),
    signatures: linesToList(signatures),
    silhouettes: linesToList(silhouettes),
    palette: linesToList(palette),
    nevers: linesToList(nevers),
  }
  const linked = new Set(row.members.map((m) => m.member_id))

  return (
    <div className="border border-[#E2E0DB] rounded-[14px] p-6 space-y-7 bg-white">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-[20px] tracking-[0.04em] text-[#2B2B2B] mr-auto">{row.name.toUpperCase()}</h2>
        {msg && <span className="text-[11px] tracking-[0.1em] text-[#7C838B]">{msg}</span>}
        <button disabled={!!busy} className={row.status === 'live' ? BTN : DARK}
          onClick={() => run('status', () => updateInfluence(row.influence_id, { status: row.status === 'live' ? 'draft' : 'live' }),
            row.status === 'live' ? 'BACK TO DRAFT' : 'LIVE — OFFERED TO CLIENTS')}>
          {row.status === 'live' ? 'TAKE BACK TO DRAFT' : 'MAKE LIVE'}
        </button>
        <button disabled={!!busy} className="text-[11px] tracking-[0.1em] text-[#B83A3A] underline"
          onClick={async () => { if (!confirm(`Delete ${row.name} and their pictures?`)) return; const r = await deleteInfluence(row.influence_id); if (r.error) setMsg(r.error.toUpperCase()); else onDeleted() }}>
          DELETE
        </button>
      </div>

      {/* Who they are */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <label className="block"><span className={LABEL}>NAME</span><input value={name} onChange={(e) => setName(e.target.value)} className={`${FIELD} mt-1`} /></label>
        <label className="block"><span className={LABEL}>KIND</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as InfluenceKind)} className={`${FIELD} mt-1`}>
            {INFLUENCE_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
          </select>
        </label>
        <label className="block"><span className={LABEL}>INSTAGRAM HANDLE</span><input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@" className={`${FIELD} mt-1`} /></label>
      </div>

      {/* The brief, in words */}
      <div className="space-y-4">
        <label className="block"><span className={LABEL}>THEIR STYLE, IN A SENTENCE OR TWO</span>
          <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} className={`${FIELD} mt-1 resize-y`} />
        </label>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {([
            ['SIGNATURES (ONE PER LINE)', signatures, setSignatures],
            ['SHAPES', silhouettes, setSilhouettes],
            ['PALETTE', palette, setPalette],
            ['NEVER', nevers, setNevers],
          ] as const).map(([label, value, set]) => (
            <label key={label} className="block"><span className={LABEL}>{label}</span>
              <textarea value={value} onChange={(e) => set(e.target.value)} rows={6} className={`${FIELD} mt-1 resize-y text-[13px]`} />
            </label>
          ))}
        </div>
        <button disabled={!!busy} className={DARK}
          onClick={() => run('save', () => updateInfluence(row.influence_id, { name, kind, handle, brief }), 'SAVED')}>
          {busy === 'save' ? 'SAVING…' : 'SAVE'}
        </button>
      </div>

      {/* Pictures */}
      <div>
        <p className={`${LABEL} mb-2`}>PICTURES · {images.filter((i) => i.status === 'scored').length} SCORED — THESE PULL HER LOOKS TOWARDS THIS PERSON</p>
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); void addPictures(imagesFrom(e.dataTransfer.files)) }}
          className={`border-2 border-dashed rounded-[12px] px-6 py-6 mb-4 text-center ${dragging ? 'border-[#0A0A0A] bg-[#F4F3F0]' : 'border-[#C3BFB8]'}`}
        >
          <p className="text-[16px] tracking-[0.08em] text-[#0A0A0A]">{busy === 'add' ? 'WORKING…' : 'PASTE (⌘V) · OR DROP PICTURES'}</p>
          <div className="flex flex-wrap items-center justify-center gap-2 mt-3">
            <label className={`${BTN} cursor-pointer`}>
              CHOOSE PICTURES
              <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { void addPictures(Array.from(e.target.files ?? [])); e.target.value = '' }} />
            </label>
            <input value={links} onChange={(e) => setLinks(e.target.value)} placeholder="OR PASTE IMAGE LINKS" className={`${FIELD} w-[280px]`} />
            <button disabled={!!busy || !links.trim()} onClick={() => addPictures([], links)} className={BTN}>ADD LINKS</button>
          </div>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-8 gap-3">
          {images.map((img) => (
            <div key={img.image_id} className="group relative aspect-[3/4] rounded-[8px] overflow-hidden bg-[#F4F3F0]">
              <FallbackImage src={img.image_url} thumbWidth={400} alt="" className="absolute inset-0 w-full h-full object-cover" />
              {row.image_url === img.image_url && (
                <span className="absolute top-1.5 left-1.5 text-[9px] tracking-[0.12em] bg-[#0A0A0A] text-white px-2 py-0.5 rounded-full">PORTRAIT</span>
              )}
              <span className="absolute bottom-0 inset-x-0 bg-white/90 text-[10px] tracking-[0.06em] text-[#4A4E57] px-2 py-1">
                {img.status === 'scored' ? `${img.item_types.slice(0, 3).join(', ') || 'scored'}${img.formality ? ` · F${img.formality}` : ''}` : img.scoring_error ? 'COULD NOT SCORE' : 'SCORING…'}
              </span>
              <div className="absolute top-1.5 right-1.5 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => run('portrait', () => updateInfluence(row.influence_id, { image_url: img.image_url }), 'PORTRAIT SET')}
                  className="bg-white text-[9px] tracking-[0.1em] px-2 py-1 rounded-full">PORTRAIT</button>
                <button onClick={() => run('remove', () => removeInfluenceImage(img.image_id), 'PICTURE REMOVED')}
                  className="bg-white text-[9px] tracking-[0.1em] text-[#B83A3A] px-2 py-1 rounded-full">REMOVE</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Clients */}
      <div>
        <p className={`${LABEL} mb-2`}>CLIENTS INSPIRED BY {row.name.toUpperCase()}</p>
        <div className="flex flex-wrap items-center gap-2">
          {row.members.map((m) => (
            <span key={m.member_id} className="inline-flex items-center gap-2 border border-[#0A0A0A] rounded-full pl-3 pr-1 py-1 text-[13px] text-[#2B2B2B]">
              {m.name}
              <span className="text-[9px] tracking-[0.1em] text-[#A8A8A4]">{m.source === 'member' ? 'HER PICK' : 'YOURS'}</span>
              <button aria-label={`Unlink ${m.name}`} onClick={() => run('unlink', () => unlinkInfluenceMember(row.influence_id, m.member_id), 'UNLINKED')}
                className="w-6 h-6 rounded-full hover:bg-[#F4F3F0] text-[#6B6B6B]">×</button>
            </span>
          ))}
          <select value={addMember} onChange={(e) => setAddMember(e.target.value)} className={`${FIELD} w-[220px]`}>
            <option value="">Link a client…</option>
            {members.filter((m) => !linked.has(m.member_id)).map((m) => <option key={m.member_id} value={m.member_id}>{m.name}</option>)}
          </select>
          <button disabled={!!busy || !addMember} className={BTN}
            onClick={() => run('link', async () => { const r = await linkInfluenceMember(row.influence_id, addMember); setAddMember(''); return r }, 'LINKED — ON TOP OF HER STYLIST')}>
            LINK
          </button>
        </div>
      </div>
    </div>
  )
}
