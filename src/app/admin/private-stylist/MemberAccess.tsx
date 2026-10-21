'use client'

// HER EMAIL FOR THE DOOR — and whether she has a login yet.
//
// Chloe writes the email a member will type on the app's door; the door sends
// a code to that email and nothing else. Shown wherever Chloe looks at a
// member's access (HER VIEW beside the invite link, and the MEMBERS card).

import { useEffect, useState } from 'react'
import { loadMemberAccess, setMemberInviteEmail, type MemberAccessView } from './invite-actions'

export default function MemberAccess({ memberId, name }: { memberId: string; name: string }) {
  const [view, setView] = useState<MemberAccessView | null>(null)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const first = name.split(' ')[0]

  useEffect(() => {
    let live = true
    setView(null); setNote(null)
    loadMemberAccess(memberId).then((v) => { if (!live) return; setView(v); setEmail(v.inviteEmail ?? v.loginEmail ?? '') })
    return () => { live = false }
  }, [memberId])

  async function save() {
    if (busy) return
    setBusy(true); setNote(null)
    const r = await setMemberInviteEmail(memberId, email)
    setBusy(false)
    if (r.error) { setNote(r.error); return }
    setView((v) => (v ? { ...v, inviteEmail: r.inviteEmail ?? null } : v))
    setEmail(r.inviteEmail ?? '')
    setNote(r.inviteEmail ? `Saved. ${first} types this on the door and gets a code.` : 'Cleared.')
  }

  const dirty = view ? (email.trim().toLowerCase() !== (view.inviteEmail ?? '')) : false

  return (
    <div className="px-1 pb-3 space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[13px] tracking-[0.14em] text-[#7C838B]">HER EMAIL FOR THE DOOR</span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void save() }}
          placeholder={view ? 'her email' : 'loading…'}
          disabled={!view || busy}
          className="w-[300px] max-w-full text-[13px] px-3 py-2 border border-[#C3BFB8] bg-white text-[#2B2B2B] disabled:opacity-50"
        />
        <button onClick={save} disabled={!view || busy || !dirty} className="text-[13px] tracking-[0.14em] px-4 py-2 border border-[#2B2B2B] text-[#2B2B2B] disabled:opacity-40">
          {busy ? 'SAVING…' : 'SAVE'}
        </button>
        {view && (
          <span className={`text-[13px] tracking-[0.1em] ${view.hasLogin ? 'text-[#3D7A50]' : 'text-[#7C838B]'}`}>
            {view.hasLogin
              ? `LOGIN: YES${view.loginEmail ? ` · ${view.loginEmail.toUpperCase()}` : ''}`
              : 'LOGIN: NOT YET — SHE MAKES ONE FROM THE DOOR OR THE INVITE LINK'}
          </span>
        )}
      </div>
      {note && <p className="text-[13px] tracking-[0.06em] text-[#4A4E57]">{note}</p>}
    </div>
  )
}
