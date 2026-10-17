'use client'

// SHARE — pass this outfit, or this piece, to a friend on MYRA. One button
// wherever a look or a piece is drawn; a small sheet to pick the friends and
// say a word; it lands in the chat the two of them share.

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { listMyFriends, shareWithFriends, type Friend, type ShareAttachment } from '@/app/me/sharing/actions'
import ShareAttachmentView from './ShareAttachmentView'
import { RoomIcon } from './RoomNav'

const T = 'text-[18px] xl:text-[21px] 2xl:text-[24px]'

export default function ShareWithFriend({
  attachment, testMemberId, label = 'Share', className, variant = 'outline',
}: {
  attachment: ShareAttachment
  testMemberId?: string
  label?: string
  className?: string
  /** `outline` is a pill beside other actions; `quiet` is an underlined word; `icon` is the bubbles alone. */
  variant?: 'outline' | 'quiet' | 'icon'
}) {
  const [open, setOpen] = useState(false)
  const cls = variant === 'icon'
    ? 'inline-flex items-center justify-center w-10 h-10 rounded-full bg-[rgba(255,255,255,0.92)] text-[#2B2B2B] shadow-[0_1px_8px_rgba(43,43,43,0.12)] hover:bg-white'
    : variant === 'quiet'
      ? `${T} inline-flex items-center gap-2 text-[#6E6B65] underline underline-offset-4 hover:text-[#2B2B2B]`
      : `${T} inline-flex items-center gap-2.5 px-5 py-2.5 rounded-full border border-[#2B2B2B] text-[#2B2B2B] hover:bg-[rgba(255,255,255,0.35)]`
  return (
    <>
      <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(true) }} aria-label={variant === 'icon' ? 'Share with a friend' : undefined} className={`${cls} ${className ?? ''}`}>
        <span className={variant === 'icon' ? 'block w-6 h-6' : 'block w-6 h-6 xl:w-7 xl:h-7'}><RoomIcon id="sharing" /></span>
        {variant !== 'icon' && <span>{label}</span>}
      </button>
      {open && <ShareSheet attachment={attachment} testMemberId={testMemberId} onClose={() => setOpen(false)} />}
    </>
  )
}

function ShareSheet({ attachment, testMemberId, onClose }: { attachment: ShareAttachment; testMemberId?: string; onClose: () => void }) {
  const [friends, setFriends] = useState<Friend[] | null>(null)
  const [test, setTest] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void listMyFriends(testMemberId).then((r) => { if (!live) return; setFriends(r.friends); setTest(r.test); if (r.error) setError(r.error) })
    return () => { live = false }
  }, [testMemberId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function toggle(id: string) {
    setPicked((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }

  async function send() {
    if (!picked.size || busy) return
    setBusy(true); setError(null)
    const r = await shareWithFriends(Array.from(picked), note, attachment, testMemberId)
    setBusy(false)
    if (r.error) { setError(r.error); return }
    const names = (friends ?? []).filter((f) => picked.has(f.member_id)).map((f) => f.name.split(' ')[0])
    setDone(names.length <= 2 ? names.join(' and ') : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`)
    setTimeout(onClose, 1400)
  }

  if (typeof document === 'undefined') return null
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label="Share with a friend" onClick={(e) => e.stopPropagation()}>
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-[rgba(43,43,43,0.35)]" />
      <div data-lenis-prevent className="relative w-full sm:w-[min(640px,94vw)] max-h-[92vh] overflow-y-auto myra-pearl rounded-t-[26px] sm:rounded-[26px] shadow-[0_-8px_40px_rgba(43,43,43,0.25)] px-6 sm:px-8 pt-6 pb-[calc(24px+env(safe-area-inset-bottom))] sm:pb-8">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <p className="text-[15px] sm:text-[16px] tracking-[0.16em] text-[#7C838B] mb-1">SHARING IS CARING</p>
            <p className="text-[26px] sm:text-[32px] tracking-[0.04em] text-[#0A0A0A] leading-none">SHARE WITH A FRIEND</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-[#7C838B] hover:text-[#0A0A0A] text-[34px] leading-none -mt-1">×</button>
        </div>

        <div className="mb-5"><ShareAttachmentView attachment={attachment} compact /></div>

        {done ? (
          <p className={`myra-guide-text normal-case ${T} text-[#3D6B45]`}>Sent to {done}.</p>
        ) : friends === null ? (
          <p className={`myra-guide-text normal-case ${T} text-[#7C838B]`}>Finding your friends…</p>
        ) : friends.length === 0 ? (
          <div className="space-y-3">
            <p className={`myra-guide-text normal-case ${T} text-[#55534E]`}>No friends on MYRA yet. Add one by her email or her @handle, and once she accepts you can share with her.</p>
            <Link href="/me/sharing" className={`${T} inline-block px-5 py-2.5 rounded-full bg-[#2B2B2B] text-white`}>Add a friend</Link>
          </div>
        ) : (
          <>
            <p className="text-[15px] sm:text-[16px] tracking-[0.14em] text-[#7C838B] mb-3">TO</p>
            <div className="flex flex-wrap gap-2 mb-5">
              {friends.map((f) => {
                const on = picked.has(f.member_id)
                return (
                  <button key={f.member_id} type="button" onClick={() => toggle(f.member_id)} aria-pressed={on}
                    className={`${T} inline-flex items-center gap-2.5 rounded-full pl-1.5 pr-4 py-1.5 border transition-colors ${on ? 'bg-[#2B2B2B] text-white border-[#2B2B2B]' : 'bg-white/85 text-[#2B2B2B] border-[rgba(43,43,43,0.2)] hover:border-[#2B2B2B]'}`}>
                    <Initial name={f.name} dark={!on} />
                    <span className="myra-guide-text normal-case">{f.name.split(' ')[0]}</span>
                  </button>
                )
              })}
            </div>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="A word to go with it (optional)"
              className={`myra-guide-text normal-case w-full ${T} bg-white border border-[rgba(43,43,43,0.25)] rounded-[18px] px-5 py-3.5 text-[#2B2B2B] placeholder:text-[#A8A8A4] focus:outline-none focus:border-[#2B2B2B] resize-none`} />
            {error && <p className={`myra-guide-text normal-case ${T} text-[#B83A3A] mt-3`}>{error}</p>}
            <div className="flex items-center justify-between gap-4 mt-4">
              {test ? <p className="text-[14px] tracking-[0.1em] text-[#7C838B]">TESTING AS HER — NOTHING IS SENT</p> : <span />}
              <button type="button" onClick={() => void send()} disabled={busy || !picked.size || test}
                className={`${T} px-6 py-3 rounded-full bg-[#2B2B2B] text-white disabled:opacity-40`}>
                {busy ? 'Sending…' : picked.size > 1 ? `Send to ${picked.size}` : 'Send'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}

/** Her first letter in a circle: the only portrait a friend has here for now. */
export function Initial({ name, dark = true, size = 'sm' }: { name: string; dark?: boolean; size?: 'sm' | 'md' | 'lg' }) {
  const dim = size === 'lg' ? 'w-14 h-14 text-[24px]' : size === 'md' ? 'w-11 h-11 text-[19px]' : 'w-8 h-8 text-[15px]'
  return (
    <span aria-hidden className={`${dim} shrink-0 rounded-full flex items-center justify-center tracking-normal ${dark ? 'bg-[#2B2B2B] text-white' : 'bg-white text-[#2B2B2B]'}`}>
      {(name.trim()[0] ?? '?').toUpperCase()}
    </span>
  )
}
