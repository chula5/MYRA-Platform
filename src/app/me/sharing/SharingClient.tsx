'use client'

// SHARING IS CARING — the room.
//
// Down the left: friends asking to share with her, her chats, her friends and
// the way to add one (by email or @handle — she accepts on her side, or there
// is no friendship). On the right: the open chat, where outfits, pieces she
// found and a word of advice pass between them. On a phone the list and the
// chat take turns on the one screen.
//
// Chloe testing as her (HER VIEW) sees everything and sends nothing.

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import MicButton from '@/components/me/MicButton'
import ShareAttachmentView from '@/components/me/ShareAttachmentView'
import { Initial } from '@/components/me/ShareWithFriend'
import { RoomIcon } from '@/components/me/RoomNav'
import {
  answerFriendRequest, askToBeFriends, findPeople, loadChat, loadSharing, sendShareMessage, setMyHandle, startGroupChat, unfriend,
  type ChatSummary, type FoundPerson, type ShareMessage, type SharingView,
} from './actions'

const T = 'text-[18px] xl:text-[21px] 2xl:text-[24px]'
const T_SMALL = 'text-[16px] xl:text-[18px] 2xl:text-[21px]'
const LABEL = 'text-[15px] xl:text-[17px] 2xl:text-[19px] tracking-[0.16em] text-[#7C838B]'
const CARD = 'rounded-[18px] bg-white/85 shadow-[0_2px_14px_rgba(43,43,43,0.08)]'
const CHAT_POLL_MS = 8_000
const LIST_POLL_MS = 30_000

export default function SharingClient({ initial, testMemberId, openChatId }: { initial?: SharingView; testMemberId?: string; openChatId?: string }) {
  const [view, setView] = useState<SharingView | null>(initial ?? null)
  const [chatId, setChatId] = useState<string | null>(openChatId ?? null)
  const [pane, setPane] = useState<'list' | 'chat'>(openChatId ? 'chat' : 'list')
  const [groupOpen, setGroupOpen] = useState(false)

  const refresh = useCallback(async () => {
    const v = await loadSharing(testMemberId)
    setView(v)
  }, [testMemberId])

  // HER VIEW gives no server-rendered view: fetch it as her.
  useEffect(() => { if (!initial) void refresh() }, [initial, refresh])
  useEffect(() => {
    const t = setInterval(() => { void refresh() }, LIST_POLL_MS)
    return () => clearInterval(t)
  }, [refresh])

  function openChat(id: string) {
    setChatId(id); setPane('chat'); setGroupOpen(false)
    try { window.dispatchEvent(new Event('myra:sharing-read')) } catch { /* no window */ }
  }

  const chat = view?.chats.find((c) => c.chat_id === chatId) ?? null
  const first = view?.name ? view.name.split(' ')[0] : ''

  return (
    <div className="-mx-6 sm:-mx-10 -my-10 min-h-[calc(100vh-80px)] flex flex-col">
      {/* The top of the room. On a phone it steps aside while a chat is open. */}
      <header className={`px-6 sm:px-10 pt-8 sm:pt-10 pb-6 ${pane === 'chat' ? 'hidden md:block' : ''}`}>
        {/* Just the one line up top (Chloe, 2026-10-17): no small SHARING label over it. */}
        <h1 className="text-[clamp(30px,3.6vw,52px)] 2xl:text-[clamp(46px,3.6vw,76px)] tracking-[0.03em] text-[#2B2B2B] leading-[1.05]">SHARING IS CARING</h1>
        <p className={`myra-guide-text normal-case ${T} text-[#55534E] mt-3 max-w-3xl`}>
          Friends find you by your email{view?.handle ? <> or <span className="text-[#2B2B2B]">@{view.handle}</span></> : ''}.
          {view && !view.test && <> <HandleEditor handle={view.handle} onSaved={(h) => setView((v) => (v ? { ...v, handle: h } : v))} /></>}
        </p>
        {view?.test && <p className="text-[14px] sm:text-[15px] tracking-[0.1em] text-[#7C838B] mt-3">TESTING AS {first.toUpperCase()} — NOTHING IS SENT</p>}
        {view?.error && <p className={`myra-guide-text normal-case ${T} text-[#B83A3A] mt-3`}>{view.error}</p>}
      </header>

      <div className="flex-1 grid grid-cols-1 md:grid-cols-[380px_minmax(0,1fr)] xl:grid-cols-[440px_minmax(0,1fr)] md:border-t md:border-[rgba(43,43,43,0.14)]">
        {/* ── Left: asks, chats, friends ───────────────────────────────── */}
        <aside className={`${pane === 'chat' ? 'hidden md:block' : ''} md:border-r md:border-[rgba(43,43,43,0.14)] px-6 sm:px-10 md:pr-6 py-6 space-y-8 overflow-y-auto`} data-lenis-prevent>
          {!view ? (
            <p className={`myra-guide-text normal-case ${T} text-[#7C838B]`}>Opening…</p>
          ) : (
            <>
              {view.requestsIn.length > 0 && (
                <section>
                  <p className={`${LABEL} mb-3`}>FRIENDS ASKING</p>
                  <div className="space-y-2">
                    {view.requestsIn.map((r) => (
                      <AskRow key={r.friendship_id} name={r.name} handle={r.handle} test={view.test}
                        onAnswer={async (yes) => {
                          const res = await answerFriendRequest(r.friendship_id, yes, testMemberId)
                          await refresh()
                          if (yes && res.chatId) openChat(res.chatId)
                          return res.error ?? null
                        }} />
                    ))}
                  </div>
                </section>
              )}

              <section>
                <div className="flex items-center justify-between mb-3">
                  <p className={LABEL}>YOUR CHATS</p>
                  {view.friends.length >= 2 && (
                    <button type="button" onClick={() => setGroupOpen((o) => !o)} className={`${T_SMALL} tracking-[0.08em] text-[#2B2B2B] underline underline-offset-4`}>
                      {groupOpen ? 'Close' : '+ Group'}
                    </button>
                  )}
                </div>
                {groupOpen && (
                  <GroupMaker view={view} testMemberId={testMemberId} onMade={async (id) => { setGroupOpen(false); await refresh(); openChat(id) }} />
                )}
                {view.chats.length === 0 ? (
                  <p className={`myra-guide-text normal-case ${T_SMALL} text-[#7C838B]`}>
                    {view.friends.length ? 'Share something from your looks, or say hello below.' : 'Add a friend and a chat opens the moment she says yes.'}
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {view.chats.map((c) => <ChatRow key={c.chat_id} chat={c} active={c.chat_id === chatId} onOpen={() => openChat(c.chat_id)} />)}
                  </ul>
                )}
              </section>

              <section>
                <p className={`${LABEL} mb-3`}>FRIENDS</p>
                <AddFriend testMemberId={testMemberId} test={view.test} onChanged={refresh} />
                {view.requestsOut.length > 0 && (
                  <ul className="mt-4 space-y-1">
                    {view.requestsOut.map((r) => (
                      <li key={r.friendship_id} className="flex items-center gap-3 px-2 py-2">
                        <Initial name={r.name} dark={false} size="md" />
                        <span className="min-w-0 flex-1">
                          <span className={`myra-guide-text normal-case block truncate ${T_SMALL} text-[#55534E]`}>{r.name}</span>
                          <span className="block text-[14px] tracking-[0.1em] text-[#A8A8A4]">WAITING FOR HER</span>
                        </span>
                        {!view.test && <button type="button" onClick={async () => { await unfriend(r.member_id, testMemberId); await refresh() }} className="text-[14px] tracking-[0.1em] text-[#7C838B] hover:text-[#2B2B2B]">TAKE BACK</button>}
                      </li>
                    ))}
                  </ul>
                )}
                {view.friends.length > 0 && (
                  <ul className="mt-4 space-y-1">
                    {view.friends.map((f) => {
                      const direct = view.chats.find((c) => !c.is_group && c.others.length === 1 && c.others[0].member_id === f.member_id)
                      return (
                        <li key={f.member_id} className="flex items-center gap-3 px-2 py-2">
                          <Initial name={f.name} size="md" />
                          <span className="min-w-0 flex-1">
                            <span className={`myra-guide-text normal-case block truncate ${T_SMALL} text-[#2B2B2B]`}>{f.name}</span>
                            {f.handle && <span className="block text-[14px] tracking-[0.08em] text-[#A8A8A4] truncate">@{f.handle}</span>}
                          </span>
                          {direct && <button type="button" onClick={() => openChat(direct.chat_id)} className="text-[14px] tracking-[0.1em] text-[#2B2B2B] underline underline-offset-4">CHAT</button>}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>
            </>
          )}
        </aside>

        {/* ── Right: the open chat ─────────────────────────────────────── */}
        <section className={`${pane === 'list' ? 'hidden md:flex' : 'flex'} flex-col min-h-[60vh] md:min-h-0`}>
          {chat ? (
            <ChatPane key={chat.chat_id} chat={chat} test={!!view?.test} testMemberId={testMemberId} onBack={() => setPane('list')} onSent={refresh} />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-8 py-16">
              <span className="block w-24 h-24 text-[#B9BCC2] mb-5"><RoomIcon id="sharing" /></span>
              <p className={`myra-guide-text normal-case ${T} text-[#7C838B] max-w-md`}>
                {view?.friends.length ? 'Pick a chat, or share something from your looks and it will land here.' : 'Add a friend by her email or @handle. Once she accepts, you can share outfits with each other here.'}
              </p>
              {!!view?.friends.length && <Link href="/me/looks" className={`${T_SMALL} mt-6 inline-block px-5 py-2.5 rounded-full border border-[#2B2B2B] text-[#2B2B2B]`}>Your looks</Link>}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

// ── Pieces of the room ──────────────────────────────────────────────────────

function HandleEditor({ handle, onSaved }: { handle: string | null; onSaved: (h: string) => void }) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(handle ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="underline underline-offset-4 text-[#2B2B2B]">{handle ? 'Change your handle' : 'Choose a handle'}</button>
  return (
    <span className="inline-flex flex-wrap items-center gap-2 align-middle">
      <span className="inline-flex items-center bg-white border border-[rgba(43,43,43,0.25)] rounded-full pl-4 pr-1 py-1">
        <span className="text-[#7C838B]">@</span>
        <input value={value} onChange={(e) => setValue(e.target.value)} autoFocus maxLength={30} placeholder="yourname" aria-label="Your handle"
          className={`myra-guide-text normal-case bg-transparent ${T_SMALL} w-[160px] px-1 py-1 focus:outline-none text-[#2B2B2B]`} />
        <button type="button" disabled={busy} onClick={async () => {
          setBusy(true); setError(null)
          const r = await setMyHandle(value)
          setBusy(false)
          if (r.error) { setError(r.error); return }
          onSaved(r.handle!); setOpen(false)
        }} className={`${T_SMALL} rounded-full bg-[#2B2B2B] text-white px-4 py-1.5 disabled:opacity-40`}>{busy ? '…' : 'Keep'}</button>
      </span>
      <button type="button" onClick={() => { setOpen(false); setError(null) }} className="text-[14px] tracking-[0.1em] text-[#7C838B]">CANCEL</button>
      {error && <span className="text-[#B83A3A]">{error}</span>}
    </span>
  )
}

function AskRow({ name, handle, test, onAnswer }: { name: string; handle: string | null; test: boolean; onAnswer: (yes: boolean) => Promise<string | null> }) {
  const [busy, setBusy] = useState<'yes' | 'no' | null>(null)
  const [error, setError] = useState<string | null>(null)
  return (
    <div className={`${CARD} px-4 py-3`}>
      <div className="flex items-center gap-3">
        <Initial name={name} size="md" />
        <span className="min-w-0 flex-1">
          <span className={`myra-guide-text normal-case block truncate ${T_SMALL} text-[#2B2B2B]`}>{name}</span>
          <span className="block text-[14px] tracking-[0.08em] text-[#A8A8A4] truncate">{handle ? `@${handle} · ` : ''}WOULD LIKE TO SHARE WITH YOU</span>
        </span>
      </div>
      <div className="flex items-center gap-2 mt-3">
        <button type="button" disabled={!!busy || test} onClick={async () => { setBusy('yes'); setError(await onAnswer(true)); setBusy(null) }}
          className={`${T_SMALL} px-4 py-2 rounded-full bg-[#2B2B2B] text-white disabled:opacity-40`}>{busy === 'yes' ? '…' : 'Yes, please'}</button>
        <button type="button" disabled={!!busy || test} onClick={async () => { setBusy('no'); setError(await onAnswer(false)); setBusy(null) }}
          className={`${T_SMALL} px-4 py-2 rounded-full text-[#6E6B65] underline underline-offset-4 disabled:opacity-40`}>Not now</button>
      </div>
      {error && <p className={`myra-guide-text normal-case ${T_SMALL} text-[#B83A3A] mt-2`}>{error}</p>}
    </div>
  )
}

function ChatRow({ chat, active, onOpen }: { chat: ChatSummary; active: boolean; onOpen: () => void }) {
  const when = chat.last ? ago(chat.last.created_at) : ''
  return (
    <li>
      <button type="button" onClick={onOpen} className={`w-full flex items-center gap-3 text-left rounded-[16px] px-3 py-3 transition-colors ${active ? 'bg-white shadow-[0_2px_14px_rgba(43,43,43,0.08)]' : 'hover:bg-white/60'}`}>
        {chat.is_group ? <GroupMark names={chat.others.map((o) => o.name)} /> : <Initial name={chat.title} size="lg" />}
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-3">
            <span className={`myra-guide-text normal-case truncate ${T} ${chat.unread ? 'text-[#0A0A0A]' : 'text-[#2B2B2B]'}`}>{chat.title}</span>
            {when && <span className="shrink-0 text-[13px] tracking-[0.08em] text-[#A8A8A4]">{when}</span>}
          </span>
          <span className={`myra-guide-text normal-case block truncate ${T_SMALL} ${chat.unread ? 'text-[#2B2B2B]' : 'text-[#7C838B]'}`}>
            {chat.last ? `${chat.last.sender_name}: ${chat.last.body}` : 'Say hello'}
          </span>
        </span>
        {chat.unread > 0 && <span aria-label={`${chat.unread} new`} className="shrink-0 min-w-[26px] h-[26px] px-2 rounded-full bg-[#2B2B2B] text-white text-[14px] tracking-normal flex items-center justify-center">{chat.unread}</span>}
      </button>
    </li>
  )
}

function GroupMark({ names }: { names: string[] }) {
  const a = names[0] ?? '?'
  const b = names[1] ?? names[0] ?? '?'
  return (
    <span aria-hidden className="relative w-14 h-14 shrink-0">
      <span className="absolute left-0 top-0 w-10 h-10 rounded-full bg-white text-[#2B2B2B] text-[18px] flex items-center justify-center ring-2 ring-[#E6E6E9]">{a.trim()[0]?.toUpperCase()}</span>
      <span className="absolute right-0 bottom-0 w-10 h-10 rounded-full bg-[#2B2B2B] text-white text-[18px] flex items-center justify-center ring-2 ring-[#E6E6E9]">{b.trim()[0]?.toUpperCase()}</span>
    </span>
  )
}

function GroupMaker({ view, testMemberId, onMade }: { view: SharingView; testMemberId?: string; onMade: (chatId: string) => Promise<void> }) {
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <div className={`${CARD} px-4 py-4 mb-4`}>
      <p className="text-[14px] tracking-[0.14em] text-[#7C838B] mb-3">A GROUP OF FRIENDS</p>
      <div className="flex flex-wrap gap-2">
        {view.friends.map((f) => {
          const on = picked.has(f.member_id)
          return (
            <button key={f.member_id} type="button" aria-pressed={on} onClick={() => setPicked((cur) => { const n = new Set(cur); if (n.has(f.member_id)) n.delete(f.member_id); else n.add(f.member_id); return n })}
              className={`${T_SMALL} inline-flex items-center gap-2 rounded-full pl-1.5 pr-4 py-1.5 border ${on ? 'bg-[#2B2B2B] text-white border-[#2B2B2B]' : 'bg-white text-[#2B2B2B] border-[rgba(43,43,43,0.2)]'}`}>
              <Initial name={f.name} dark={!on} /><span className="myra-guide-text normal-case">{f.name.split(' ')[0]}</span>
            </button>
          )
        })}
      </div>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Call it something (optional)" maxLength={60}
        className={`myra-guide-text normal-case mt-3 w-full ${T_SMALL} bg-white border border-[rgba(43,43,43,0.25)] rounded-full px-4 py-2.5 text-[#2B2B2B] placeholder:text-[#A8A8A4] focus:outline-none focus:border-[#2B2B2B]`} />
      {error && <p className={`myra-guide-text normal-case ${T_SMALL} text-[#B83A3A] mt-2`}>{error}</p>}
      <button type="button" disabled={busy || picked.size < 2 || view.test} onClick={async () => {
        setBusy(true); setError(null)
        const r = await startGroupChat(Array.from(picked), title, testMemberId)
        setBusy(false)
        if (r.error || !r.chatId) { setError(r.error ?? 'Could not start the chat'); return }
        await onMade(r.chatId)
      }} className={`${T_SMALL} mt-3 px-5 py-2.5 rounded-full bg-[#2B2B2B] text-white disabled:opacity-40`}>{busy ? 'Starting…' : 'Start the chat'}</button>
    </div>
  )
}

function AddFriend({ testMemberId, test, onChanged }: { testMemberId?: string; test: boolean; onChanged: () => Promise<void> }) {
  const [q, setQ] = useState('')
  const [people, setPeople] = useState<FoundPerson[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [asking, setAsking] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Look as she types, a beat after she stops.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    const text = q.trim()
    if (text.length < 2) { setPeople(null); return }
    timer.current = setTimeout(async () => {
      setSearching(true)
      const r = await findPeople(text, testMemberId)
      setSearching(false)
      setPeople(r.people); if (r.error) setNote(r.error)
    }, 350)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [q, testMemberId])

  async function ask(p: FoundPerson) {
    setAsking(p.member_id); setNote(null)
    const r = await askToBeFriends(p.member_id, testMemberId)
    setAsking(null)
    if (r.error) { setNote(r.error); return }
    setNote(`Asked ${p.name.split(' ')[0]} — she has to say yes on her side.`)
    setPeople((cur) => (cur ?? []).map((x) => (x.member_id === p.member_id ? { ...x, relationship: 'asked' } : x)))
    await onChanged()
  }

  return (
    <div>
      <div className="relative">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add a friend by email or @handle" aria-label="Add a friend by email or handle" autoCapitalize="none" autoCorrect="off"
          className={`myra-guide-text normal-case w-full ${T_SMALL} bg-white border border-[rgba(43,43,43,0.25)] rounded-full pl-12 pr-4 py-3 text-[#2B2B2B] placeholder:text-[#A8A8A4] focus:outline-none focus:border-[#2B2B2B]`} />
        <span aria-hidden className="absolute left-4 top-1/2 -translate-y-1/2 text-[#7C838B] text-[22px] leading-none">+</span>
      </div>
      {searching && <p className={`myra-guide-text normal-case ${T_SMALL} text-[#A8A8A4] mt-2 px-2`}>Looking…</p>}
      {!searching && people && people.length === 0 && (
        <p className={`myra-guide-text normal-case ${T_SMALL} text-[#7C838B] mt-2 px-2`}>
          {q.includes('@') && !q.startsWith('@') ? 'No one on MYRA with that email yet. She can apply at myraassistant.co.uk.' : 'No one by that name or handle.'}
        </p>
      )}
      {!!people?.length && (
        <ul className="mt-2 space-y-1">
          {people.map((p) => (
            <li key={p.member_id} className="flex items-center gap-3 px-2 py-2">
              <Initial name={p.name} size="md" />
              <span className="min-w-0 flex-1">
                <span className={`myra-guide-text normal-case block truncate ${T_SMALL} text-[#2B2B2B]`}>{p.name}</span>
                {p.handle && <span className="block text-[14px] tracking-[0.08em] text-[#A8A8A4] truncate">@{p.handle}</span>}
              </span>
              {p.relationship === 'friends' ? <span className="text-[14px] tracking-[0.1em] text-[#7C838B]">FRIENDS</span>
                : p.relationship === 'asked' ? <span className="text-[14px] tracking-[0.1em] text-[#7C838B]">ASKED</span>
                : p.relationship === 'asked_you' ? <span className="text-[14px] tracking-[0.1em] text-[#7C838B]">ASKED YOU ↑</span>
                : <button type="button" disabled={asking === p.member_id || test} onClick={() => void ask(p)} className={`${T_SMALL} px-4 py-1.5 rounded-full bg-[#2B2B2B] text-white disabled:opacity-40`}>{asking === p.member_id ? '…' : 'Ask'}</button>}
            </li>
          ))}
        </ul>
      )}
      {note && <p className={`myra-guide-text normal-case ${T_SMALL} mt-2 px-2 ${/^Asked/.test(note) ? 'text-[#3D6B45]' : 'text-[#B83A3A]'}`}>{note}</p>}
    </div>
  )
}

function ChatPane({ chat, test, testMemberId, onBack, onSent }: { chat: ChatSummary; test: boolean; testMemberId?: string; onBack: () => void; onSent: () => Promise<void> }) {
  const [messages, setMessages] = useState<ShareMessage[] | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)

  const load = useCallback(async () => {
    const r = await loadChat(chat.chat_id, testMemberId)
    setMessages(r.messages); if (r.error) setError(r.error)
  }, [chat.chat_id, testMemberId])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const t = setInterval(() => { void load() }, CHAT_POLL_MS)
    return () => clearInterval(t)
  }, [load])

  // Keep the newest in view, unless she has scrolled up to read.
  useEffect(() => {
    const el = scroller.current
    if (el && atBottom.current) el.scrollTo({ top: el.scrollHeight, behavior: messages && messages.length > 30 ? 'auto' : 'smooth' })
  }, [messages])

  async function send(text: string) {
    const body = text.trim()
    if (!body || busy) return
    setBusy(true); setError(null); setDraft('')
    const r = await sendShareMessage(chat.chat_id, body, null, testMemberId)
    setBusy(false)
    if (r.error || !r.message) { setError(r.error ?? 'Could not send'); setDraft(body); return }
    atBottom.current = true
    setMessages((cur) => [...(cur ?? []), r.message!])
    void onSent()
  }

  return (
    <>
      <header className="flex items-center gap-3 px-6 sm:px-8 py-4 border-b border-[rgba(43,43,43,0.14)]">
        <button type="button" onClick={onBack} aria-label="Back to your chats" className="md:hidden text-[26px] leading-none text-[#7C838B] hover:text-[#2B2B2B] pr-1">←</button>
        {chat.is_group ? <GroupMark names={chat.others.map((o) => o.name)} /> : <Initial name={chat.title} size="lg" />}
        <div className="min-w-0">
          <p className={`myra-guide-text normal-case truncate text-[22px] sm:text-[26px] text-[#0A0A0A] leading-tight`}>{chat.title}</p>
          <p className="text-[14px] sm:text-[15px] tracking-[0.1em] text-[#7C838B] truncate">
            {chat.is_group ? chat.others.map((o) => o.name.split(' ')[0]).join(', ').toUpperCase() : chat.others[0]?.handle ? `@${chat.others[0].handle}` : 'FRIENDS ON MYRA'}
          </p>
        </div>
      </header>

      <div ref={scroller} data-lenis-prevent onScroll={(e) => { const el = e.currentTarget; atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80 }}
        className="flex-1 overflow-y-auto px-6 sm:px-8 py-6 max-h-[calc(100vh-330px)] md:max-h-none">
        {messages === null ? (
          <p className={`myra-guide-text normal-case ${T} text-[#A8A8A4]`}>Opening…</p>
        ) : messages.length === 0 ? (
          <p className={`myra-guide-text normal-case ${T} text-[#7C838B] max-w-lg`}>
            Nothing here yet. Say hello — or share an outfit from your looks, a piece from your dressing room, and it lands here.
          </p>
        ) : (
          <div className="space-y-5">
            {messages.map((m, i) => <Bubble key={m.message_id} m={m} group={chat.is_group} first={i === 0 || messages[i - 1].sender_id !== m.sender_id} />)}
          </div>
        )}
        {error && <p className={`myra-guide-text normal-case ${T} text-[#B83A3A] mt-4`}>{error}</p>}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); void send(draft) }} className="border-t border-[rgba(43,43,43,0.14)] px-6 sm:px-8 pt-4 pb-6 myra-pearl">
        <div className="flex items-center gap-2">
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={test ? 'Testing as her — nothing is sent' : `Say something to ${chat.is_group ? 'the group' : chat.title.split(' ')[0]}…`} disabled={test}
            className={`myra-guide-text normal-case flex-1 min-w-0 bg-white border border-[rgba(43,43,43,0.25)] rounded-full px-6 py-4 ${T} text-[#2B2B2B] placeholder:text-[#A8A8A4] focus:outline-none focus:border-[#2B2B2B] disabled:opacity-60`} />
          <MicButton onText={(t, final) => { setDraft(t); if (final && t.trim() && !busy && !test) void send(t) }} />
          <button type="submit" disabled={busy || !draft.trim() || test} aria-label="Send" className="w-14 h-14 rounded-full bg-[#2B2B2B] text-white flex items-center justify-center hover:bg-[#0A0A0A] disabled:opacity-40">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><path d="M4 12h15M13 6l6 6-6 6" /></svg>
          </button>
        </div>
        <p className="text-[13px] sm:text-[14px] tracking-[0.1em] text-[#A8A8A4] mt-3">TO SHARE AN OUTFIT OR A PIECE, USE SHARE ON IT IN YOUR LOOKS OR YOUR DRESSING ROOM</p>
      </form>
    </>
  )
}

function Bubble({ m, group, first }: { m: ShareMessage; group: boolean; first: boolean }) {
  const hasAttachment = !!m.payload
  return (
    <div className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`${hasAttachment ? 'w-[min(420px,88%)]' : 'max-w-[88%]'}`}>
        {!m.mine && group && first && <p className="text-[14px] tracking-[0.14em] text-[#7C838B] mb-1">{m.sender_name.toUpperCase()}</p>}
        <div className={`rounded-[22px] overflow-hidden ${m.mine ? 'bg-[#2B2B2B] text-white' : 'bg-white/85 text-[#2B2B2B] shadow-[0_2px_14px_rgba(43,43,43,0.08)]'}`}>
          {m.payload && <div className={m.mine ? 'p-2 pb-0' : 'p-2 pb-0'}><ShareAttachmentView attachment={m.payload} /></div>}
          {m.body && <p className={`myra-guide-text normal-case ${T} leading-relaxed whitespace-pre-wrap px-5 py-3.5`}>{m.body}</p>}
          {!m.body && m.payload && <div className="h-2" />}
        </div>
        <p className={`text-[12px] tracking-[0.08em] text-[#A8A8A4] mt-1 ${m.mine ? 'text-right' : ''}`}>{ago(m.created_at)}</p>
      </div>
    </div>
  )
}

/** "JUST NOW", "4 MIN", "YESTERDAY", "12 OCT" — short, for a chat. */
function ago(iso: string): string {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  const s = Math.max(0, (Date.now() - t) / 1000)
  if (s < 60) return 'JUST NOW'
  if (s < 3600) return `${Math.floor(s / 60)} MIN`
  if (s < 86400) return `${Math.floor(s / 3600)} H`
  if (s < 172800) return 'YESTERDAY'
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).toUpperCase()
}
