'use client'

// STYLIST LENS — a button in the corner of every one of her pages that opens
// the house: pick a stylist, talk to her, get pieces and outfits back in her
// way. Sciura, the chief, is the one to ask "who should dress me".
//
// Looks come back as the same card the dressing room draws; pieces as tiles
// that open the shop. Nothing here is a lookalike of another surface.

import { useEffect, useRef, useState } from 'react'
import ComposedLookCard from '@/components/me/ComposedLookCard'
import FallbackImage from '@/components/FallbackImage'
import {
  listChatStylists, loadStylistThread, sendToStylist,
  type ChatStylist, type ChatMessage,
} from './stylist-chat-actions'

const QUICK = [
  { label: 'Dinner', ask: 'What would you put me in for dinner?' },
  { label: 'Work', ask: 'Dress me for a working day.' },
  { label: 'Weekend', ask: 'Something for the weekend, please.' },
  { label: 'A coat', ask: 'Find me a coat.' },
]
const QUICK_CHIEF = [
  { label: 'Who should dress me?', ask: 'Who should dress me, and why?' },
  { label: 'My style', ask: 'What have you read about my style so far?' },
]

export default function StylistChat({ asMemberId }: { asMemberId?: string }) {
  const [open, setOpen] = useState(false)
  const [stylists, setStylists] = useState<ChatStylist[]>([])
  const [memberName, setMemberName] = useState('')
  const [test, setTest] = useState(false)
  const [current, setCurrent] = useState<ChatStylist | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || stylists.length) return
    listChatStylists(asMemberId).then((r) => {
      setStylists(r.stylists); setMemberName(r.memberName); setTest(r.test)
      if (r.error) setError(r.error)
    })
  }, [open, stylists.length, asMemberId])

  useEffect(() => {
    setMessages([]); setError(null)
    if (!current) return
    loadStylistThread(current.stylist_id, asMemberId).then((r) => { setMessages(r.messages); if (r.error) setError(r.error) })
  }, [current, asMemberId])

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy])

  async function send(text: string) {
    if (!current || busy) return
    const body = text.trim()
    if (!body) return
    setDraft('')
    setError(null)
    const mine: ChatMessage = { message_id: `m-${Date.now()}`, role: 'member', body, created_at: new Date().toISOString() }
    const history = messages.map((m) => ({ role: m.role, body: m.body }))
    setMessages((ms) => [...ms, mine])
    setBusy(true)
    const r = await sendToStylist(current.stylist_id, body, history, asMemberId)
    setBusy(false)
    if (r.error || !r.reply) { setError(r.error ?? 'No answer'); return }
    setMessages((ms) => [...ms, r.reply!])
  }

  const quick = current?.chief ? QUICK_CHIEF : QUICK

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Talk to a stylist"
          className="fixed right-5 bottom-5 z-[56] flex items-center gap-3 bg-[#2B2B2B] text-white rounded-full pl-4 pr-5 py-3 shadow-[0_6px_24px_rgba(43,43,43,0.28)] hover:bg-[#0A0A0A] transition-colors"
        >
          <SpeechIcon className="w-6 h-6" />
          <span className="text-[16px] tracking-[0.16em]">STYLIST</span>
        </button>
      )}

      {/* A panel beside the page, not over it: the site stays live and clickable. */}
      <aside className={`fixed right-0 top-0 h-full z-[57] w-[max(45vw,520px)] max-w-[96vw] myra-pearl shadow-[-8px_0_32px_rgba(43,43,43,0.16)] border-l border-[rgba(43,43,43,0.14)] flex flex-col transition-transform duration-300 ${open ? 'translate-x-0' : 'translate-x-full pointer-events-none'}`}>
          {/* Header: the house, or the stylist she is with */}
          <div className="border-b border-[rgba(43,43,43,0.14)] px-8 pt-7 pb-5 flex items-start justify-between gap-4 flex-shrink-0">
            <div className="min-w-0">
              {current ? (
                <button onClick={() => setCurrent(null)} className="text-[18px] tracking-[0.16em] text-[#7C838B] hover:text-[#2B2B2B] mb-2">← STYLIST LENS</button>
              ) : (
                <p className="text-[18px] tracking-[0.16em] text-[#7C838B] mb-2">MYRA</p>
              )}
              {current ? (
                <div className="flex items-center gap-4">
                  <Avatar s={current} size={80} />
                  <div className="min-w-0">
                    <p className="text-[32px] tracking-[0.04em] text-[#0A0A0A] leading-tight truncate">{current.name.toUpperCase()}</p>
                    <p className="myra-guide-text text-[20px] text-[#55534E] leading-snug">{current.chief ? 'Chief stylist — routes and blends every look' : current.tagline}</p>
                  </div>
                </div>
              ) : (
                <p className="text-[44px] tracking-[0.04em] text-[#0A0A0A] leading-none">STYLIST LENS</p>
              )}
            </div>
            <button onClick={() => setOpen(false)} aria-label="Close" className="text-[#7C838B] hover:text-[#0A0A0A] text-[34px] leading-none -mt-1">×</button>
          </div>

          <div ref={scroller} data-lenis-prevent className="flex-1 overflow-y-auto px-8 py-6">
            {!current ? (
              <>
                <p className="myra-guide-text text-[24px] text-[#2B2B2B] mb-7">
                  {memberName ? `${memberName.split(' ')[0]}, who would you like to dress you today?` : 'Who would you like to dress you today?'}
                </p>
                {error && <p className="myra-guide-text text-[20px] text-[#B83A3A] mb-4">{error}</p>}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5">
                  {stylists.map((s) => (
                    <button key={s.stylist_id} onClick={() => setCurrent(s)} className="text-left bg-white/85 rounded-[16px] overflow-hidden shadow-[0_2px_14px_rgba(43,43,43,0.08)] hover:shadow-[0_4px_20px_rgba(43,43,43,0.16)] transition-shadow">
                      <div className="relative aspect-[4/5] bg-[#E4E2DD]">
                        {s.image_url ? (
                          <FallbackImage src={s.image_url} thumbWidth={500} alt="" className="absolute inset-0 w-full h-full object-cover" />
                        ) : (
                          <span className="absolute inset-0 flex items-center justify-center text-[72px] text-[#7C838B]">{s.name.slice(0, 1)}</span>
                        )}
                        {s.chief && <span className="absolute top-2 left-2 bg-[#2B2B2B] text-white text-[13px] tracking-[0.14em] px-2.5 py-1 rounded-full">CHIEF</span>}
                        {s.hers && <span className="absolute top-2 right-2 bg-white text-[#2B2B2B] text-[13px] tracking-[0.14em] px-2.5 py-1 rounded-full">YOURS</span>}
                      </div>
                      <div className="px-4 py-4">
                        <p className="text-[22px] tracking-[0.08em] text-[#0A0A0A] leading-tight">{s.name.toUpperCase()}</p>
                        <p className="myra-guide-text text-[18px] text-[#55534E] leading-snug mt-1">{s.chief ? 'Routes and blends every look' : s.ready ? s.tagline : `${s.tagline} · still learning`}</p>
                      </div>
                    </button>
                  ))}
                  {!stylists.length && !error && <p className="myra-guide-text text-[17px] text-[#A8A8A4] col-span-full py-10 text-center">Opening the house…</p>}
                </div>
              </>
            ) : (
              <div className="space-y-5">
                {!messages.length && !busy && (
                  <p className="myra-guide-text text-[22px] text-[#55534E]">
                    {current.chief
                      ? `Ask me who should dress you. I read your pictures, your dressing room and your brands, and I say who — in one line.`
                      : `Tell me where you are going, or what you want to wear, and I will dress you my way.`}
                  </p>
                )}
                {messages.map((m) => <Bubble key={m.message_id} m={m} stylist={current} />)}
                {busy && <p className="myra-guide-text text-[20px] text-[#A8A8A4]">{current.name} is thinking…</p>}
                {error && <p className="myra-guide-text text-[20px] text-[#B83A3A]">{error}</p>}
              </div>
            )}
          </div>

          {current && (
            <div className="border-t border-[rgba(43,43,43,0.14)] px-8 pt-4 pb-6 flex-shrink-0 myra-pearl">
              <div className="flex gap-2 overflow-x-auto pb-3 -mx-1 px-1">
                {quick.map((q) => (
                  <button key={q.label} onClick={() => send(q.ask)} disabled={busy} className="whitespace-nowrap border border-[rgba(43,43,43,0.25)] rounded-full px-5 py-2 text-[16px] tracking-[0.1em] text-[#2B2B2B] hover:bg-[#2B2B2B] hover:text-white transition-colors disabled:opacity-50">
                    {q.label.toUpperCase()}
                  </button>
                ))}
              </div>
              <form onSubmit={(e) => { e.preventDefault(); void send(draft) }} className="flex items-center gap-2">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={current.chief ? 'Ask Sciura…' : `Ask ${current.name}…`}
                  className="myra-guide-text flex-1 bg-white border border-[rgba(43,43,43,0.25)] rounded-full px-6 py-4 text-[20px] text-[#2B2B2B] placeholder:text-[#A8A8A4] focus:outline-none focus:border-[#2B2B2B]"
                />
                <button type="submit" disabled={busy || !draft.trim()} aria-label="Send" className="w-14 h-14 rounded-full bg-[#2B2B2B] text-white flex items-center justify-center hover:bg-[#0A0A0A] disabled:opacity-40">
                  <SendIcon className="w-5 h-5" />
                </button>
              </form>
              {test && <p className="text-[15px] tracking-[0.1em] text-[#7C838B] mt-2">TESTING AS HER — NOTHING IS KEPT</p>}
            </div>
          )}
      </aside>
    </>
  )
}

function Bubble({ m, stylist }: { m: ChatMessage; stylist: ChatStylist }) {
  const mine = m.role === 'member'
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[92%] ${mine ? '' : 'w-full'}`}>
        {!mine && <p className="text-[15px] tracking-[0.14em] text-[#7C838B] mb-1">{stylist.name.toUpperCase()}</p>}
        <p className={`myra-guide-text text-[20px] leading-relaxed whitespace-pre-wrap rounded-[20px] px-6 py-4 ${mine ? 'bg-[#2B2B2B] text-white' : 'bg-white/85 text-[#2B2B2B] shadow-[0_2px_14px_rgba(43,43,43,0.08)]'}`}>{m.body}</p>
        {!!m.looks?.length && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            {m.looks.map((l) => <ComposedLookCard key={l.look_id} look={l as any} />)}
          </div>
        )}
        {!!m.items?.length && (
          <div className="grid grid-cols-3 lg:grid-cols-4 gap-4 mt-5">
            {m.items.map((it) => (
              <a key={it.item_id} href={it.url ?? undefined} target="_blank" rel="noreferrer" className="bg-white/85 rounded-[12px] overflow-hidden shadow-[0_2px_14px_rgba(43,43,43,0.08)]">
                <div className="relative aspect-[3/4] bg-white">
                  {it.image_url && <FallbackImage src={it.image_url} thumbWidth={300} alt={it.name} className="absolute inset-0 w-full h-full object-contain" />}
                </div>
                <div className="px-2 py-2">
                  <p className="text-[15px] tracking-[0.1em] text-[#0A0A0A] truncate">{it.brand.toUpperCase()}</p>
                  <p className="myra-guide-text text-[16px] text-[#55534E] leading-snug line-clamp-2">{it.name}</p>
                  <p className="text-[15px] tracking-[0.06em] text-[#7C838B] mt-1">{it.owned ? 'YOURS' : it.price_gbp != null ? `£${Math.round(it.price_gbp)}` : ''}</p>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Avatar({ s, size }: { s: ChatStylist; size: number }) {
  return (
    <div className="relative rounded-full overflow-hidden bg-[#E4E2DD] flex-shrink-0" style={{ width: size, height: size }}>
      {s.image_url
        ? <FallbackImage src={s.image_url} thumbWidth={200} alt="" className="absolute inset-0 w-full h-full object-cover" />
        : <span className="absolute inset-0 flex items-center justify-center text-[#7C838B]" style={{ fontSize: size * 0.45 }}>{s.name.slice(0, 1)}</span>}
    </div>
  )
}

function SpeechIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 5.5h16v10H9l-5 4v-4H4z" />
    </svg>
  )
}

function SendIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 12h15M13 6l6 6-6 6" />
    </svg>
  )
}
