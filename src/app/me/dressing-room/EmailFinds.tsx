'use client'

// FIND WHAT YOU'VE BOUGHT — connect an inbox, let MYRA read the past year of
// order and return emails, and add the pieces she kept to the wardrobe one by one.

import { useEffect, useRef, useState } from 'react'
import FallbackImage from '@/components/FallbackImage'
import {
  addFindPhoto, addFoundPiece, connectVirginMedia, disconnectInbox, keepReturned, loadEmailPanel, notMine, removeReturned,
  scanAgain, scanNow,
  type EmailPanelView,
} from './email-actions'

const VIRGIN_HELP = 'https://www.virginmedia.com/help/broadband/manage-email-settings'

export default function EmailFinds({ testMemberId, onAdded }: { testMemberId?: string; onAdded?: () => void }) {
  const [view, setView] = useState<EmailPanelView | null>(null)
  const [showVirgin, setShowVirgin] = useState(false)
  const [email, setEmail] = useState('')
  const [appPassword, setAppPassword] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const scanning = useRef(false)

  const refresh = async () => setView(await loadEmailPanel(testMemberId))

  useEffect(() => {
    void refresh()
    // Messages from the Google round trip.
    const q = new URLSearchParams(window.location.search)
    if (q.get('email_connected')) setMsg('Gmail connected — reading the past year of order emails.')
    if (q.get('email_error')) setMsg(q.get('email_error'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testMemberId])

  const running = !!view?.connections.some((c) => c.scan && (c.scan.status === 'queued' || c.scan.status === 'running'))

  // While a scan is going, keep it moving and keep the counts fresh.
  useEffect(() => {
    if (!running || scanning.current) return
    let live = true
    const tick = async () => {
      scanning.current = true
      while (live) {
        const r = await scanNow(testMemberId)
        const v = await loadEmailPanel(testMemberId)
        if (!live) break
        setView(v)
        if (!v.connections.some((c) => c.scan && (c.scan.status === 'queued' || c.scan.status === 'running')) || (r.remaining ?? 0) === 0) break
        // Another tab or the cron has the scan — look again shortly rather than spinning.
        if (!r.read) await new Promise((res) => setTimeout(res, 5000))
      }
      scanning.current = false
    }
    void tick()
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, testMemberId])

  async function connectVirgin() {
    setBusy('virgin')
    setMsg('Checking the app password with Virgin Media…')
    const r = await connectVirginMedia(email, appPassword, testMemberId)
    setBusy(null)
    setAppPassword('')
    if (r.error) { setMsg(r.error); return }
    setShowVirgin(false)
    setMsg('Connected — reading the past year of order emails.')
    await refresh()
  }

  async function act(key: string, fn: () => Promise<{ error?: string }>, done?: string) {
    setBusy(key)
    const r = await fn()
    setBusy(null)
    setMsg(r.error ?? done ?? null)
    await refresh()
  }

  if (!view) return null
  if (!view.memberId) return null
  const returnPath = testMemberId ? '/admin/private-stylist' : '/me/dressing-room'
  const gmailHref = `/api/email/google/start?return=${encodeURIComponent(returnPath)}${testMemberId ? `&member=${testMemberId}` : ''}`

  return (
    <section className="max-w-[1400px] mx-auto border border-[#2B2B2B] bg-[rgba(255,255,255,0.18)] px-5 md:px-8 py-7 mb-10 space-y-6">
      <div>
        <h2 className="myra-section-label">FIND WHAT YOU&rsquo;VE BOUGHT</h2>
        <p className="text-[20px] text-[#2B2B2B] mt-3 max-w-3xl">
          Connect your email and MYRA reads your order confirmations from the past year, finds the clothes, shoes and bags you bought, and lets you add them to your dressing room.
          Only order emails are read, and nothing else is kept.
        </p>
        {view.test && (
          <p className="text-[18px] tracking-[0.08em] text-[#8B5E00] mt-3">
            NOTE: CONNECTING HERE CONNECTS HER REAL INBOX — ADDING A PIECE ADDS IT TO HER REAL WARDROBE.
          </p>
        )}
      </div>

      {view.error && <p className="text-[20px] text-[#B83A3A]">{view.error}</p>}
      {msg && <p className="text-[20px] text-[#2B2B2B]">{msg}</p>}

      {/* Connected inboxes */}
      {view.connections.length > 0 && (
        <div className="space-y-3">
          {view.connections.map((c) => (
            <div key={c.connection_id} className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[#C3BFB8] pt-3">
              <p className="text-[20px] text-[#2B2B2B]">{c.provider === 'gmail' ? 'Gmail' : 'Virgin Media'} · {c.email}</p>
              <p className="text-[18px] text-[#55534E]">
                {c.status === 'error' ? <span className="text-[#B83A3A]">{c.error}</span>
                  : c.scan && (c.scan.status === 'queued' || c.scan.status === 'running')
                    ? (c.scan.phase === 'list' ? 'Looking for order emails…' : `Reading ${c.scan.read} of ${c.scan.total} order emails · ${c.scan.found} pieces found`)
                    : c.scan?.status === 'failed' ? <span className="text-[#B83A3A]">Scan stopped: {c.scan.error}</span>
                      : c.last_scanned_at ? `Last read ${new Date(c.last_scanned_at).toLocaleDateString('en-GB')}` : 'Not read yet'}
              </p>
              <button disabled={!!busy} onClick={() => act(`scan-${c.connection_id}`, () => scanAgain(c.connection_id, testMemberId), 'Reading new order emails…')} className="text-[18px] underline underline-offset-4 text-[#2B2B2B] disabled:opacity-40">Read again</button>
              <button disabled={!!busy} onClick={() => { if (confirm(`Disconnect ${c.email}? MYRA forgets the connection; pieces already found stay here.`)) void act(`disc-${c.connection_id}`, () => disconnectInbox(c.connection_id, testMemberId), 'Disconnected.') }} className="text-[18px] underline underline-offset-4 text-[#B83A3A] disabled:opacity-40">Disconnect</button>
            </div>
          ))}
        </div>
      )}

      {/* Connect */}
      <div className="flex flex-wrap gap-3">
        {view.gmailReady ? (
          <a href={gmailHref} className="text-[22px] px-7 py-3.5 bg-[#2B2B2B] text-white">Connect Gmail</a>
        ) : (
          <span className="text-[20px] px-6 py-3 border border-[#C3BFB8] text-[#8C8A85]" title="Needs the Google keys set up">Connect Gmail (not set up yet)</span>
        )}
        <button onClick={() => setShowVirgin(!showVirgin)} className="text-[22px] px-7 py-3.5 border border-[#2B2B2B] text-[#2B2B2B]">
          Connect Virgin Media / Blueyonder mail
        </button>
      </div>

      {showVirgin && (
        <div className="border border-[#C3BFB8] bg-[rgba(255,255,255,0.35)] px-5 py-5 space-y-4 max-w-2xl">
          <p className="text-[20px] text-[#2B2B2B]">Virgin Media needs an <b>app password</b> for this — not your usual password. It only opens your mail, and you can cancel it any time.</p>
          <ol className="text-[20px] text-[#2B2B2B] list-decimal pl-6 space-y-1">
            <li>Sign in to My Virgin Media and go to <b>Account settings → Account details</b>.</li>
            <li>Under <b>Virgin Media Mail</b>, choose <b>Manage</b> next to app password, then <b>Generate new app password</b>.</li>
            <li>Copy it and paste it below.</li>
          </ol>
          <a href={VIRGIN_HELP} target="_blank" rel="noopener noreferrer" className="text-[18px] underline underline-offset-4 text-[#2B2B2B]">Virgin Media&rsquo;s help page →</a>
          <div className="flex flex-col gap-3">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Your email, e.g. name@blueyonder.co.uk"
              autoComplete="email"
              className="text-[20px] bg-white border border-[#6E6B65] px-4 py-3 focus:outline-none focus:border-[#2B2B2B]"
            />
            <input
              value={appPassword}
              onChange={(e) => setAppPassword(e.target.value)}
              placeholder="Virgin Media Mail app password"
              type="password"
              autoComplete="off"
              className="text-[20px] bg-white border border-[#6E6B65] px-4 py-3 focus:outline-none focus:border-[#2B2B2B]"
            />
            <button
              disabled={busy === 'virgin' || !email.trim() || !appPassword || !view.secretsReady}
              onClick={connectVirgin}
              className="text-[22px] px-7 py-3.5 bg-[#2B2B2B] text-white disabled:opacity-40 self-start"
            >
              {busy === 'virgin' ? 'Checking…' : 'Connect'}
            </button>
          </div>
        </div>
      )}

      {/* Pieces in the dressing room that an email says went back */}
      {view.returned.length > 0 && (
        <div className="space-y-3 border-t border-[#C3BFB8] pt-5">
          <p className="myra-section-note">SENT BACK · STILL IN YOUR DRESSING ROOM</p>
          {view.returned.map((f) => (
            <div key={f.find_id} className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <p className="text-[20px] text-[#2B2B2B]">{f.product_name}{f.brand_name ? ` · ${f.brand_name}` : f.retailer ? ` · ${f.retailer}` : ''}</p>
              <button disabled={!!busy} onClick={() => act(`rm-${f.find_id}`, () => removeReturned(f.find_id, testMemberId), `${f.product_name} is out of your dressing room.`)} className="text-[18px] px-4 py-2 bg-[#2B2B2B] text-white disabled:opacity-40">Remove it</button>
              <button disabled={!!busy} onClick={() => act(`keep-${f.find_id}`, () => keepReturned(f.find_id, testMemberId))} className="text-[18px] underline underline-offset-4 text-[#55534E] disabled:opacity-40">I still have it</button>
            </div>
          ))}
        </div>
      )}

      {/* Found pieces */}
      {view.finds.length > 0 && (
        <div className="space-y-4">
          <p className="myra-section-note">FOUND IN YOUR EMAIL · {view.finds.length} TO LOOK THROUGH</p>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-[6px]">
            {view.finds.map((f) => (
              <div key={f.find_id} className="bg-white flex flex-col">
                <div className="relative aspect-[3/4] bg-[#EDEDED] overflow-hidden">
                  {f.image_url ? (
                    <FallbackImage src={f.image_url} thumbWidth={500} alt={f.product_name} className="absolute inset-0 w-full h-full object-contain" />
                  ) : (
                    // Some shops (Vinted) send no photo — she adds her own.
                    <label className={`absolute inset-0 flex flex-col items-center justify-center gap-3 px-4 text-center cursor-pointer hover:bg-[#E4E2DE] ${busy ? 'pointer-events-none opacity-50' : ''}`}>
                      <span className="text-[18px] text-[#6E6B65]">No photo in the email</span>
                      <span className="text-[18px] px-4 py-2 border border-[#2B2B2B] text-[#2B2B2B]">{busy === `photo-${f.find_id}` ? 'Uploading…' : 'Add a photo'}</span>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (!file) return
                          const fd = new FormData()
                          fd.set('find_id', f.find_id)
                          fd.set('file', file)
                          if (testMemberId) fd.set('as_member_id', testMemberId)
                          void act(`photo-${f.find_id}`, () => addFindPhoto(fd))
                        }}
                      />
                    </label>
                  )}
                </div>
                <div className="px-3 py-3 flex flex-col gap-1 flex-1">
                  <p className="text-[20px] text-[#2B2B2B] leading-tight line-clamp-2">{f.product_name}</p>
                  <p className="text-[18px] text-[#6E6B65]">
                    {[f.brand_name ?? f.retailer, f.size, f.order_date ? new Date(f.order_date).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : null].filter(Boolean).join(' · ')}
                  </p>
                  {f.price != null && <p className="text-[18px] text-[#55534E]">{f.currency === 'GBP' || !f.currency ? '£' : `${f.currency} `}{Math.round(f.price)}</p>}
                  {f.error === 'Return started' ? (
                    <p className="text-[18px] text-[#8B5E00]">You started a return — add it only if you kept it</p>
                  ) : f.error ? (
                    <p className="text-[18px] text-[#B83A3A]">{f.error}</p>
                  ) : null}
                  <div className="mt-auto pt-2 flex flex-col gap-2">
                    <button
                      disabled={!!busy}
                      onClick={async () => {
                        setBusy(f.find_id)
                        setMsg(`Adding ${f.product_name}…`)
                        const r = await addFoundPiece(f.find_id, testMemberId)
                        setBusy(null)
                        setMsg(r.error ?? `${f.product_name} is in your dressing room.`)
                        await refresh()
                        if (!r.error) onAdded?.()
                      }}
                      className="text-[18px] py-2.5 bg-[#2B2B2B] text-white disabled:opacity-40"
                    >
                      {busy === f.find_id ? 'Adding…' : 'Add to my wardrobe'}
                    </button>
                    <button disabled={!!busy} onClick={() => act(`no-${f.find_id}`, () => notMine(f.find_id, testMemberId))} className="text-[18px] py-2 text-[#55534E] underline underline-offset-4 disabled:opacity-40">
                      Not mine
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
