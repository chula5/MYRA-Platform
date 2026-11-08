'use client'

// MY AVATAR — the screens: consent and photos → making (portrait) → choose a face → making
// (body) → review → ready. Polls while MYRA works. Big type, black and silver, full width.

import { useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { startMyAvatar, chooseMyPortrait, approveMyAvatar, retakeMyAvatar, deleteMyAvatar, loadMyAvatar, type MyAvatarView } from './actions'
import { CONSENT_TEXT } from './consent'

const EYEBROW = 'text-[13px] tracking-[0.22em] uppercase text-[#7C838B]'
const BTN = 'inline-flex items-center justify-center rounded-full border border-[#141414] px-6 py-3 text-[14px] tracking-[0.1em] uppercase disabled:opacity-40'
const BTN_DARK = `${BTN} bg-[#141414] text-[#F7F6F3]`

export default function AvatarClient({ view: initial }: { view: MyAvatarView }) {
  const [view, setView] = useState(initial)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const working = view.avatar?.status === 'portrait' || view.avatar?.status === 'body'

  // While MYRA works, ask again every few seconds.
  useEffect(() => {
    if (!working) return
    const t = setInterval(async () => {
      const v = await loadMyAvatar()
      if (!('error' in v)) setView(v)
    }, 4000)
    return () => clearInterval(t)
  }, [working])

  const refresh = async () => { const v = await loadMyAvatar(); if (!('error' in v)) setView(v) }
  const run = (fn: () => Promise<{ error?: string }>) => start(async () => { setError(null); const r = await fn(); if (r.error) setError(r.error); await refresh() })

  const a = view.avatar
  return (
    <div className="space-y-6 pb-16">
      <div>
        <p className={EYEBROW}>Dressing room</p>
        <h1 className="mt-1 text-[clamp(26px,3.2vw,44px)] tracking-[0.14em] text-[#2B2B2B] leading-[1.05]">MY AVATAR</h1>
      </div>
      {!view.configured && <p className="text-[16px] text-[#B83A3A]">MYRA&apos;s avatar studio isn&apos;t switched on in this environment yet.</p>}
      {error && <p className="text-[16px] text-[#B83A3A]">{error}</p>}

      {!a || a.status === 'retired' || a.status === 'collecting' ? <Start onSubmit={(fd) => run(() => startMyAvatar(fd))} pending={pending} firstName={view.firstName} /> : null}

      {a && (a.status === 'portrait' || a.status === 'body') && (
        <Working step={a.status} job={a.job} />
      )}

      {a && a.status === 'choose' && (
        <section className="space-y-4">
          <p className={EYEBROW}>Which one is most like you?</p>
          <p className="text-[17px] max-w-[52ch]">Two portraits from your photos. Pick the one that reads as you; it becomes the face of your avatar and is never changed again.</p>
          <div className="grid grid-cols-2 gap-4 max-w-[640px]">
            {a.portrait_urls.map((u, i) => (
              <button key={u} type="button" disabled={pending} onClick={() => run(() => chooseMyPortrait(i))} className="group text-left">
                <img src={u} alt={`Portrait ${i + 1}`} className="w-full aspect-square object-cover rounded-[18px] border border-[#DCDAD4] group-hover:border-[#141414]" />
                <span className="mt-2 block text-[14px] tracking-[0.1em] uppercase">Choose this one</span>
              </button>
            ))}
          </div>
          <button type="button" className={BTN} disabled={pending} onClick={() => run(() => retakeMyAvatar('all'))}>Start again with other photos</button>
        </section>
      )}

      {a && a.status === 'review' && a.base_url && (
        <section className="space-y-4">
          <p className={EYEBROW}>Is this you?</p>
          <div className="grid gap-6 sm:grid-cols-[minmax(0,320px)_1fr] items-start">
            <img src={a.base_url} alt="Your avatar" className="w-full rounded-[18px] bg-[#E4E2DD]" />
            <div className="space-y-4 text-[17px] max-w-[48ch]">
              <p>Your face from the portrait you chose, your build from your photos, standing as you would for a picture. Once you approve it, your pieces are dressed on it and your photos are deleted.</p>
              <div className="flex flex-wrap gap-3">
                <button type="button" className={BTN_DARK} disabled={pending} onClick={() => run(() => approveMyAvatar())}>Yes, that&apos;s me</button>
                <button type="button" className={BTN} disabled={pending} onClick={() => run(() => retakeMyAvatar('body'))}>Make the body again</button>
                <button type="button" className={BTN} disabled={pending} onClick={() => run(() => retakeMyAvatar('all'))}>Start again</button>
              </div>
            </div>
          </div>
        </section>
      )}

      {a && a.status === 'ready' && a.base_url && (
        <section className="space-y-4">
          <div className="grid gap-6 sm:grid-cols-[minmax(0,320px)_1fr] items-start">
            <img src={a.base_url} alt="Your avatar" className="w-full rounded-[18px] bg-[#E4E2DD]" />
            <div className="space-y-4 text-[17px] max-w-[48ch]">
              <p>Your avatar is ready. Your wardrobe is next: each piece is shot on it once and kept, so trying things on is instant.</p>
              <div className="flex flex-wrap gap-3">
                <Link href="/me/dressing-room" className={BTN_DARK}>To the dressing room</Link>
                <button type="button" className={BTN} disabled={pending} onClick={() => run(() => deleteMyAvatar())}>Delete my avatar</button>
              </div>
              <p className="text-[14px] text-[#7C838B]">Delete removes the avatar and every picture made from it. Your photos were deleted when you approved it.</p>
            </div>
          </div>
        </section>
      )}

      {a && a.status === 'failed' && (
        <section className="space-y-3">
          <p className="text-[17px]">MYRA couldn&apos;t finish your avatar{a.error ? `: ${a.error}` : ''}.</p>
          <div className="flex gap-3">
            {a.portrait_url && a.photos?.length ? <button type="button" className={BTN_DARK} disabled={pending} onClick={() => run(() => retakeMyAvatar('body'))}>Try the body again</button> : null}
            <button type="button" className={BTN} disabled={pending} onClick={() => run(() => retakeMyAvatar('all'))}>Start again</button>
          </div>
        </section>
      )}
    </div>
  )
}

function Working({ step, job }: { step: 'portrait' | 'body'; job: { status: string; error: string | null } | null }) {
  return (
    <section className="space-y-3">
      <p className={EYEBROW}>{step === 'portrait' ? 'Making your portrait' : 'Making your avatar'}</p>
      <p className="text-[17px] max-w-[52ch]">
        {step === 'portrait' ? 'About a minute. MYRA is drawing your face from your photos, twice, so you can pick the truer one.' : 'Two to three minutes. Your face goes onto a body built from your photos, then she stands naturally.'}
      </p>
      <div className="flex items-center gap-3 text-[14px] text-[#7C838B]">
        <span className="inline-block h-2 w-2 rounded-full bg-[#141414] animate-pulse" />
        <span>{job?.status === 'running' ? 'Working' : job?.status === 'queued' ? 'In the queue' : 'Starting'}{job?.error ? ` · retrying after: ${job.error}` : ''}</span>
      </div>
    </section>
  )
}

function Start({ onSubmit, pending, firstName }: { onSubmit: (fd: FormData) => void; pending: boolean; firstName: string }) {
  const [agreed, setAgreed] = useState(false)
  const [faces, setFaces] = useState<File[]>([])
  const [fulls, setFulls] = useState<File[]>([])
  const [height, setHeight] = useState('')
  const faceRef = useRef<HTMLInputElement | null>(null)
  const fullRef = useRef<HTMLInputElement | null>(null)
  const ready = agreed && faces.length >= 2 && fulls.length >= 1 && faces.length + fulls.length <= 6

  const submit = () => {
    const fd = new FormData()
    faces.forEach((f) => fd.append('face', f))
    fulls.forEach((f) => fd.append('full', f))
    fd.set('height_cm', height)
    fd.set('consent', agreed ? 'yes' : 'no')
    onSubmit(fd)
  }

  return (
    <section className="space-y-6 max-w-[640px]">
      <p className="text-[17px]">{firstName ? `${firstName}, three` : 'Three'} or four photos and MYRA makes an avatar of you: your face, your build, standing as you would for a picture. Every piece you own is then shot on it once, so trying things on is instant.</p>

      <div className="rounded-[16px] border border-[#DCDAD4] p-4 space-y-2 text-[15px]">
        <p className={EYEBROW}>Your photos</p>
        <p>They are used only to make your avatar, kept privately while it is made, and deleted when you approve it. MYRA keeps the avatar and the pictures it makes from it. The models used do not learn from your photos. You can delete your avatar at any time.</p>
        <label className="flex items-start gap-3 pt-1">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1 h-5 w-5" />
          <span>{CONSENT_TEXT}</span>
        </label>
      </div>

      <Picker label="Your face" hint="Two or three, straight on and a slight turn, hair as you wear it, no sunglasses" files={faces} setFiles={setFaces} max={4} inputRef={faceRef} />
      <Picker label="Full length" hint="One or two, standing, facing the camera, in fitted plain clothes, good light" files={fulls} setFiles={setFulls} max={2} inputRef={fullRef} />

      <label className="block text-[15px]">
        <span className={EYEBROW}>Height in cm · optional</span>
        <input type="number" inputMode="numeric" value={height} onChange={(e) => setHeight(e.target.value)} placeholder="168" className="mt-1 block w-32 rounded-full border border-[#DCDAD4] px-4 py-2 text-[16px]" />
      </label>

      <button type="button" className={BTN_DARK} disabled={!ready || pending} onClick={submit}>Make my avatar</button>
    </section>
  )
}

function Picker({ label, hint, files, setFiles, max, inputRef }: { label: string; hint: string; files: File[]; setFiles: (f: File[]) => void; max: number; inputRef: React.MutableRefObject<HTMLInputElement | null> }) {
  const previews = files.map((f) => URL.createObjectURL(f))
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews])
  return (
    <div className="space-y-2">
      <p className={EYEBROW}>{label}</p>
      <p className="text-[15px] text-[#7C838B]">{hint}</p>
      <div className="flex flex-wrap gap-3">
        {files.map((f, i) => (
          <button key={i} type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} className="relative h-24 w-20 overflow-hidden rounded-[12px] border border-[#DCDAD4]" aria-label={`Remove ${f.name}`}>
            <img src={previews[i]} alt="" className="h-full w-full object-cover" />
            <span className="absolute right-1 top-1 rounded-full bg-[#141414] px-1.5 text-[11px] text-white">×</span>
          </button>
        ))}
        {files.length < max && (
          <button type="button" onClick={() => inputRef.current?.click()} className="h-24 w-20 rounded-[12px] border border-dashed border-[#7C838B] text-[13px] tracking-[0.1em] uppercase text-[#7C838B]">Add</button>
        )}
      </div>
      <input ref={inputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { const picked = Array.from(e.target.files ?? []); setFiles([...files, ...picked].slice(0, max)); e.target.value = '' }} />
    </div>
  )
}
