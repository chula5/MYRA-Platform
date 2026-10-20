'use client'

import { useMemo, useState } from 'react'
import { acceptApplication, declineApplication, reopenApplication, resendInvitation, type ApplicationRow } from './actions'

export interface ApplicationView extends ApplicationRow {
  brandList: { name: string; known: boolean }[]
  hasLogin: boolean
}

type Tab = 'new' | 'accepted' | 'declined'

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''

const BTN = 'px-4 py-2 text-[10px] tracking-[0.12em] rounded-full disabled:opacity-40 transition-opacity'

export default function ApplicationsClient({ rows }: { rows: ApplicationView[] }) {
  const [tab, setTab] = useState<Tab>('new')
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<Record<string, { text: string; url?: string; bad?: boolean }>>({})
  const counts = useMemo(() => ({
    new: rows.filter((r) => r.status === 'new').length,
    accepted: rows.filter((r) => r.status === 'accepted').length,
    declined: rows.filter((r) => r.status === 'declined').length,
  }), [rows])
  const shown = rows.filter((r) => r.status === tab)

  const say = (id: string, text: string, extra: { url?: string; bad?: boolean } = {}) =>
    setNotice((n) => ({ ...n, [id]: { text, ...extra } }))

  async function accept(a: ApplicationView) {
    const who = a.name || a.email
    if (!window.confirm(`Accept ${who}?\n\nThis makes her a member with her brands in and emails her invitation to ${a.email}.`)) return
    setBusy(a.id)
    const r = await acceptApplication(a.id)
    setBusy(null)
    if (r.error) { say(a.id, r.error, { bad: true }); return }
    const brands = r.matched?.length ? `${r.matched.length} brand${r.matched.length === 1 ? '' : 's'} in` : 'no known brands'
    const kept = r.unmatched?.length ? `, ${r.unmatched.length} kept as her words` : ''
    if (r.alreadyIn) { say(a.id, `${r.memberName} already has a login, so no invitation was needed. Marked accepted.`); return }
    if (r.emailed) say(a.id, `Accepted. Invitation sent to ${a.email} (${brands}${kept}).${r.reused ? ' Her existing member record was used.' : ''}`, { url: r.inviteUrl })
    else say(a.id, `Accepted and her member made (${brands}${kept}), but the email did not go: ${r.emailError ?? 'unknown'}. Send her this link yourself.`, { url: r.inviteUrl, bad: true })
  }

  async function decline(a: ApplicationView) {
    const note = window.prompt(`Decline ${a.name || a.email}? Nothing is emailed. A note for yourself (optional):`, '')
    if (note === null) return
    setBusy(a.id)
    const r = await declineApplication(a.id, note)
    setBusy(null)
    if (r.error) say(a.id, r.error, { bad: true })
  }

  async function reopen(a: ApplicationView) {
    setBusy(a.id)
    const r = await reopenApplication(a.id)
    setBusy(null)
    if (r.error) say(a.id, r.error, { bad: true })
  }

  async function resend(a: ApplicationView) {
    if (!window.confirm(`Send ${a.name || a.email} a fresh invitation to ${a.email}?`)) return
    setBusy(a.id)
    const r = await resendInvitation(a.id)
    setBusy(null)
    if (r.error) { say(a.id, r.error, { bad: true }); return }
    if (r.emailed) say(a.id, `Invitation sent again to ${a.email}.`, { url: r.inviteUrl })
    else say(a.id, `The email did not go: ${r.emailError ?? 'unknown'}. Send her this link yourself.`, { url: r.inviteUrl, bad: true })
  }

  async function copy(id: string, url: string) {
    try { await navigator.clipboard.writeText(url); say(id, 'Link copied.', { url }) } catch { say(id, 'Select the link and copy it.', { url }) }
  }

  return (
    <div>
      <div className="flex gap-6 mb-6 border-b border-[#E2E0DB]">
        {(['new', 'accepted', 'declined'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`pb-3 text-[11px] tracking-[0.12em] -mb-px border-b ${tab === t ? 'border-[#0A0A0A] text-[#0A0A0A]' : 'border-transparent text-[#A8A8A4] hover:text-[#4A4E57]'}`}>
            {t.toUpperCase()} · {counts[t]}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="text-[11px] tracking-[0.068em] text-[#A8A8A4]">
          {tab === 'new' ? 'NOTHING NEW TO READ.' : tab === 'accepted' ? 'NO ONE ACCEPTED YET.' : 'NO ONE DECLINED.'}
        </p>
      ) : (
        <div className="border border-[#E2E0DB]">
          {shown.map((a, i) => {
            const n = notice[a.id]
            const url = n?.url ?? a.invite_url ?? undefined
            return (
              <div key={a.id} className={`px-6 py-5 border-b border-[#E2E0DB] last:border-b-0 ${i % 2 === 0 ? 'bg-white' : 'bg-[#FAFAF8]'}`}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-[1_1_360px]">
                    <p className="text-[13px] tracking-[0.05em] text-[#0A0A0A]">{(a.name || '—').toUpperCase()}</p>
                    <p className="text-[12px] tracking-[0.036em] text-[#4A4E57] mt-0.5 break-words">
                      {a.email} · applied {fmt(a.created_at)}
                      {a.reviewed_at && ` · ${a.status} ${fmt(a.reviewed_at)}`}
                      {a.status === 'accepted' && (a.hasLogin ? ' · signed in' : a.emailed_at ? ` · invitation emailed ${fmt(a.emailed_at)}` : ' · invitation NOT emailed')}
                    </p>

                    {a.brandList.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-3">
                        {a.brandList.map((b) => (
                          <span key={b.name} title={b.known ? 'MYRA knows this brand; ACCEPT ranks it' : 'Not in MYRA’s brand table yet; ACCEPT keeps it as her words'}
                            className={`px-2.5 py-1 text-[10px] tracking-[0.1em] rounded-full border ${b.known ? 'bg-[#0A0A0A] border-[#0A0A0A] text-white' : 'border-[#C3BFB8] text-[#6B6B6B]'}`}>
                            {b.name.toUpperCase()}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="mt-3 space-y-1 text-[12px] leading-[1.6] text-[#4A4E57]">
                      {a.price_range && <p><span className="tracking-[0.1em] text-[#A8A8A4] text-[10px]">SHOPS AROUND</span> &nbsp;{a.price_range}</p>}
                      {a.style_inspiration && <p><span className="tracking-[0.1em] text-[#A8A8A4] text-[10px]">INSPIRED BY</span> &nbsp;{a.style_inspiration}</p>}
                      {a.note && <p><span className="tracking-[0.1em] text-[#A8A8A4] text-[10px]">IN HER WORDS</span> &nbsp;{a.note}</p>}
                      {a.review_note && <p><span className="tracking-[0.1em] text-[#A8A8A4] text-[10px]">YOUR NOTE</span> &nbsp;{a.review_note}</p>}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 shrink-0">
                    {a.status === 'new' && (
                      <>
                        <button disabled={busy === a.id} onClick={() => accept(a)} className={`${BTN} bg-[#0A0A0A] text-white hover:opacity-85`}>
                          {busy === a.id ? 'ACCEPTING…' : 'ACCEPT'}
                        </button>
                        <button disabled={busy === a.id} onClick={() => decline(a)} className={`${BTN} border border-[#E2E0DB] text-[#6B6B6B] hover:border-[#B83A3A] hover:text-[#B83A3A]`}>
                          DECLINE
                        </button>
                      </>
                    )}
                    {a.status === 'accepted' && a.member_id && (
                      <>
                        <a href="/admin/private-stylist" className={`${BTN} border border-[#0A0A0A] text-[#0A0A0A] hover:opacity-70`}>PRIVATE STYLIST</a>
                        {!a.hasLogin && (
                          <button disabled={busy === a.id} onClick={() => resend(a)} className={`${BTN} border border-[#E2E0DB] text-[#6B6B6B] hover:border-[#0A0A0A] hover:text-[#0A0A0A]`}>
                            {busy === a.id ? 'SENDING…' : 'RESEND INVITATION'}
                          </button>
                        )}
                      </>
                    )}
                    {a.status === 'declined' && (
                      <button disabled={busy === a.id} onClick={() => reopen(a)} className={`${BTN} border border-[#E2E0DB] text-[#6B6B6B] hover:border-[#0A0A0A] hover:text-[#0A0A0A]`}>
                        BACK TO NEW
                      </button>
                    )}
                  </div>
                </div>

                {n && <p className={`mt-3 text-[12px] tracking-[0.03em] ${n.bad ? 'text-[#B83A3A]' : 'text-[#3D7A50]'}`}>{n.text}</p>}
                {a.status === 'accepted' && url && !a.hasLogin && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input readOnly value={url} onFocus={(e) => e.currentTarget.select()}
                      className="flex-1 min-w-[260px] max-w-2xl text-[12px] px-3 py-1.5 border border-[#E2E0DB] bg-white text-[#2B2B2B]" />
                    <button onClick={() => copy(a.id, url)} className={`${BTN} border border-[#E2E0DB] text-[#6B6B6B] hover:border-[#0A0A0A] hover:text-[#0A0A0A]`}>COPY LINK</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
