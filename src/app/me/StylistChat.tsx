'use client'

// STYLIST LENS — MYRA's house of stylists. Live stylist conversations retain
// their existing server behaviour; the marketplace and creator are a local,
// interactive preview for the next version of the product.

import { useEffect, useRef, useState } from 'react'
import ComposedLookCard from '@/components/me/ComposedLookCard'
import FallbackImage from '@/components/FallbackImage'
import {
  askMyraForOutfits, listChatStylists, loadStylistThread, sendToStylist,
  type ChatStylist, type ChatMessage,
} from './stylist-chat-actions'

type Face = 'round' | 'oval' | 'triangle' | 'diamond' | 'rectangle'
type Glasses = 'round-white' | 'oval-brown' | 'square-tortoise' | 'cat-eye' | 'oval-black' | 'white-black' | 'zebra-square' | 'black-cateye'
type GlassesColour = 'cream' | 'tortoise' | 'black' | 'cherry' | 'cobalt' | 'lime'
type Hair = 'bob' | 'long' | 'up'
type PreviewStylist = { id: string; name: string; tagline: string; face: Face; glasses: Glasses; glassesColour: GlassesColour; hair: Hair; custom?: boolean }
type ActiveChat =
  | { kind: 'live'; stylist: ChatStylist }
  | { kind: 'general'; preview: PreviewStylist }
  | { kind: 'custom'; preview: PreviewStylist }

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

const AVATAR_PRESETS: Record<string, Pick<PreviewStylist, 'face' | 'glasses' | 'glassesColour' | 'hair'>> = {
  sciura: { face: 'oval', glasses: 'cat-eye', glassesColour: 'black', hair: 'up' },
  'scandi-mum': { face: 'round', glasses: 'square-tortoise', glassesColour: 'tortoise', hair: 'bob' },
  'the bohemian': { face: 'round', glasses: 'round-white', glassesColour: 'cream', hair: 'long' },
  americana: { face: 'oval', glasses: 'oval-brown', glassesColour: 'tortoise', hair: 'long' },
  'the parisienne': { face: 'diamond', glasses: 'cat-eye', glassesColour: 'cherry', hair: 'bob' },
  'the gen z girl': { face: 'rectangle', glasses: 'oval-black', glassesColour: 'black', hair: 'long' },
  'the archivist': { face: 'oval', glasses: 'square-tortoise', glassesColour: 'tortoise', hair: 'up' },
  'the corporate girl': { face: 'rectangle', glasses: 'square-tortoise', glassesColour: 'black', hair: 'up' },
  mila: { face: 'triangle', glasses: 'square-tortoise', glassesColour: 'tortoise', hair: 'long' },
}
const DEFAULT_AVATAR = { face: 'oval' as Face, glasses: 'cat-eye' as Glasses, glassesColour: 'black' as GlassesColour, hair: 'bob' as Hair }
const GENERAL: PreviewStylist = { id: 'myra-search', name: 'Ask MYRA', tagline: 'A fresh search, without a named stylist', face: 'round', glasses: 'round-white', glassesColour: 'cream', hair: 'long' }
const FACE_OPTIONS: { value: Face; label: string }[] = [
  { value: 'round', label: 'Round' }, { value: 'oval', label: 'Oval' }, { value: 'triangle', label: 'Inverted triangle' },
  { value: 'diamond', label: 'Diamond' }, { value: 'rectangle', label: 'Rectangle' },
]
const GLASSES_OPTIONS: { value: Glasses; label: string }[] = [
  { value: 'white-black', label: 'White with black rims' }, { value: 'zebra-square', label: 'Zebra square' },
  { value: 'black-cateye', label: 'Black cat-eye' }, { value: 'round-white', label: 'Big white round' },
  { value: 'oval-brown', label: 'Thin brown oval' }, { value: 'square-tortoise', label: 'Tortoise square' },
  { value: 'cat-eye', label: 'Cat-eye' }, { value: 'oval-black', label: 'Black wrap oval' },
]
const GLASSES_COLOURS: { value: GlassesColour; label: string; swatch: string }[] = [
  { value: 'cream', label: 'Cream', swatch: '#F5F0E6' }, { value: 'tortoise', label: 'Tortoise', swatch: '#72472D' },
  { value: 'black', label: 'Black', swatch: '#171416' }, { value: 'cherry', label: 'Cherry', swatch: '#A7373C' },
  { value: 'cobalt', label: 'Cobalt', swatch: '#2455A6' }, { value: 'lime', label: 'Lime', swatch: '#A8BE3B' },
]

function avatarFor(s: ChatStylist): PreviewStylist {
  const preset = AVATAR_PRESETS[s.name.toLowerCase()] ?? DEFAULT_AVATAR
  return { id: s.stylist_id, name: s.name, tagline: s.chief ? 'Chief stylist, routes every look' : s.tagline, ...preset }
}

export default function StylistChat({ asMemberId }: { asMemberId?: string }) {
  const [open, setOpen] = useState(false)
  const [stylists, setStylists] = useState<ChatStylist[]>([])
  const [memberName, setMemberName] = useState('')
  const [test, setTest] = useState(false)
  const [active, setActive] = useState<ActiveChat | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [previewThreads, setPreviewThreads] = useState<Record<string, ChatMessage[]>>({})
  const [customStylists, setCustomStylists] = useState<PreviewStylist[]>([])
  const [creatorOpen, setCreatorOpen] = useState(false)
  const [creatorName, setCreatorName] = useState('')
  const [creatorView, setCreatorView] = useState('')
  const [face, setFace] = useState<Face>('round')
  const [glasses, setGlasses] = useState<Glasses>('round-white')
  const [glassesColour, setGlassesColour] = useState<GlassesColour>('cream')
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
    if (!active || active.kind !== 'live') return
    loadStylistThread(active.stylist.stylist_id, asMemberId).then((r) => { setMessages(r.messages); if (r.error) setError(r.error) })
  }, [active, asMemberId])

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })
  }, [messages, previewThreads, busy])

  const liveAvatars = stylists.map(avatarFor)
  const selectedPreview = active?.kind === 'live' ? avatarFor(active.stylist) : active?.preview ?? null
  const shownMessages = active?.kind === 'live'
    ? messages
    : active ? (previewThreads[active.preview.id] ?? []) : []
  const activeName = active?.kind === 'live' ? active.stylist.name : active?.preview.name ?? ''
  const quick = active?.kind === 'live' && active.stylist.chief ? QUICK_CHIEF : QUICK

  function startGeneral() {
    setCreatorOpen(false)
    setActive({ kind: 'general', preview: GENERAL })
  }

  function createPreview() {
    const preview: PreviewStylist = {
      id: `custom-${Date.now()}`,
      name: creatorName.trim() || 'New stylist',
      tagline: creatorView.trim() || 'A point of view made by you',
      face, glasses, glassesColour, hair: 'bob', custom: true,
    }
    setCustomStylists((current) => [...current, preview])
    setCreatorOpen(false)
    setCreatorName(''); setCreatorView('')
    setActive({ kind: 'custom', preview })
  }

  async function send(text: string) {
    if (!active || busy) return
    const body = text.trim()
    if (!body) return
    setDraft(''); setError(null)
    const mine: ChatMessage = { message_id: `m-${Date.now()}`, role: 'member', body, created_at: new Date().toISOString() }
    if (active.kind === 'general') {
      setPreviewThreads((current) => ({
        ...current,
        [active.preview.id]: [...(current[active.preview.id] ?? []), mine],
      }))
      setBusy(true)
      const r = await askMyraForOutfits(body, asMemberId)
      setBusy(false)
      if (r.error || !r.reply) { setError(r.error ?? 'No answer'); return }
      setPreviewThreads((current) => ({
        ...current,
        [active.preview.id]: [...(current[active.preview.id] ?? []), r.reply!],
      }))
      return
    }
    if (active.kind === 'custom') {
      const reply: ChatMessage = {
        message_id: `preview-${Date.now()}`, role: 'stylist', created_at: new Date().toISOString(),
        body: `I would begin with the point of view you gave me: ${active.preview.tagline.toLowerCase()}. Tell me where you are going.`,
      }
      setPreviewThreads((current) => ({
        ...current,
        [active.preview.id]: [...(current[active.preview.id] ?? []), mine, reply],
      }))
      return
    }
    const history = messages.map((m) => ({ role: m.role, body: m.body }))
    setMessages((current) => [...current, mine])
    setBusy(true)
    const r = await sendToStylist(active.stylist.stylist_id, body, history, asMemberId)
    setBusy(false)
    if (r.error || !r.reply) { setError(r.error ?? 'No answer'); return }
    setMessages((current) => [...current, r.reply!])
  }

  return (
    <>
      {!open && <button onClick={() => setOpen(true)} aria-label="Talk to a stylist" className="fixed right-5 bottom-[calc(68px+env(safe-area-inset-bottom))] sm:right-8 sm:bottom-8 z-[56] flex items-center gap-2.5 bg-[#2B2B2B] text-white rounded-full pl-4 pr-5 py-3 sm:gap-3 sm:pl-6 sm:pr-7 sm:py-3.5 shadow-[0_8px_30px_rgba(43,43,43,0.3)] hover:bg-[#0A0A0A] hover:scale-[1.03] transition-[background-color,transform]">
        <SpeechIcon className="w-5 h-5 sm:w-7 sm:h-7" /><span className="text-[14px] sm:text-[17px] tracking-[0.14em]">STYLIST</span>
      </button>}

      <aside className={`fixed right-0 top-0 h-full z-[57] w-[min(1100px,96vw)] myra-pearl shadow-[-8px_0_32px_rgba(43,43,43,0.16)] border-l border-[rgba(43,43,43,0.14)] flex flex-col transition-transform duration-300 ${open ? 'translate-x-0' : 'translate-x-full pointer-events-none'}`}>
        <header className="border-b border-[rgba(43,43,43,0.14)] px-6 sm:px-8 pt-6 pb-5 flex items-start justify-between gap-4 flex-shrink-0">
          <div>
            {active || creatorOpen ? <button onClick={() => { setActive(null); setCreatorOpen(false) }} className="text-[16px] sm:text-[19px] tracking-[0.16em] text-[#7C838B] hover:text-[#2B2B2B] mb-2">← STYLIST LENS</button> : <p className="text-[16px] sm:text-[19px] tracking-[0.16em] text-[#7C838B] mb-2">MYRA</p>}
            <p className="text-[32px] sm:text-[42px] tracking-[0.04em] text-[#0A0A0A] leading-none">{creatorOpen ? 'CREATE A STYLIST' : active ? activeName.toUpperCase() : 'STYLIST LENS'}</p>
          </div>
          <button onClick={() => setOpen(false)} aria-label="Close" className="text-[#7C838B] hover:text-[#0A0A0A] text-[36px] leading-none">×</button>
        </header>

        {creatorOpen ? <Creator face={face} glasses={glasses} glassesColour={glassesColour} name={creatorName} view={creatorView} onFace={setFace} onGlasses={setGlasses} onGlassesColour={setGlassesColour} onName={setCreatorName} onView={setCreatorView} onCreate={createPreview} />
          : active ? <ChatView active={active} avatar={selectedPreview!} messages={shownMessages} busy={busy} error={error} draft={draft} quick={quick} test={test} onDraft={setDraft} onSend={send} scroller={scroller} />
          : <LensHome memberName={memberName} stylists={liveAvatars} customStylists={customStylists} error={error} onLive={(id) => { const stylist = stylists.find((s) => s.stylist_id === id); if (stylist) setActive({ kind: 'live', stylist }) }} onGeneral={startGeneral} onCustom={(preview) => setActive({ kind: 'custom', preview })} onCreator={() => setCreatorOpen(true)} />}
      </aside>
    </>
  )
}

function LensHome({ memberName, stylists, customStylists, error, onLive, onGeneral, onCustom, onCreator }: { memberName: string; stylists: PreviewStylist[]; customStylists: PreviewStylist[]; error: string | null; onLive: (id: string) => void; onGeneral: () => void; onCustom: (s: PreviewStylist) => void; onCreator: () => void }) {
  const chats = [...stylists.slice(0, 4), ...customStylists]
  return <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[240px_1fr]">
    <nav className="border-b md:border-b-0 md:border-r border-[rgba(43,43,43,0.14)] px-5 py-5 overflow-y-auto">
      <div className="flex items-center justify-between mb-4"><p className="text-[15px] tracking-[0.14em] text-[#7C838B]">YOUR CHATS</p><button onClick={onGeneral} aria-label="New chat" className="w-8 h-8 rounded-full border border-[#2B2B2B] text-[24px] leading-none hover:bg-[#2B2B2B] hover:text-white">+</button></div>
      <button onClick={onGeneral} className="w-full text-left rounded-2xl bg-[#2B2B2B] text-white px-4 py-4 mb-5 hover:bg-[#0A0A0A]"><span className="block text-[16px] tracking-[0.1em]">+ NEW CHAT</span><span className="myra-guide-text normal-case block text-[15px] mt-1 opacity-75">Search with MYRA</span></button>
      <div className="space-y-1">{chats.map((s) => <button key={s.id} onClick={() => s.custom ? onCustom(s) : onLive(s.id)} className="w-full flex items-center gap-3 text-left rounded-xl px-2 py-2 hover:bg-white/80"><StylistAvatar {...s} size={40} /><span className="min-w-0"><span className="block truncate text-[15px] tracking-[0.07em] text-[#0A0A0A]">{s.name}</span><span className="myra-guide-text normal-case block truncate text-[14px] text-[#7C838B]">{s.custom ? 'Your new stylist' : 'Start a conversation'}</span></span></button>)}</div>
    </nav>
    <section className="overflow-y-auto px-6 sm:px-8 py-7">
      <p className="myra-guide-text normal-case text-[23px] sm:text-[27px] text-[#2B2B2B] mb-2">{memberName ? `${memberName.split(' ')[0]}, meet your stylists.` : 'Meet your stylists.'}</p>
      <p className="myra-guide-text normal-case text-[17px] sm:text-[20px] text-[#7C838B] mb-7">Each has her own eye. Choose one, or make a new point of view for yourself.</p>
      {error && <p className="myra-guide-text normal-case text-[18px] text-[#B83A3A] mb-4">{error}</p>}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">{stylists.map((s) => <StylistCard key={s.id} s={s} onClick={() => onLive(s.id)} />)}{customStylists.map((s) => <StylistCard key={s.id} s={s} onClick={() => onCustom(s)} />)}<button onClick={onCreator} className="min-h-[205px] rounded-[24px] border border-dashed border-[rgba(43,43,43,0.45)] flex flex-col items-center justify-center gap-3 text-[#2B2B2B] hover:bg-white/70"><span className="w-12 h-12 rounded-full border border-current flex items-center justify-center text-[34px] font-normal">+</span><span className="text-[16px] tracking-[0.11em]">CREATE A STYLIST</span></button></div>
    </section>
  </div>
}

function StylistCard({ s, onClick }: { s: PreviewStylist; onClick: () => void }) { return <button onClick={onClick} className="group text-left p-3 sm:p-4 hover:-translate-y-1 transition-transform focus:outline-none"><StylistAvatar {...s} size={104} /><p className="mt-4 text-[16px] sm:text-[18px] tracking-[0.08em] text-[#0A0A0A]">{s.name}</p><p className="myra-guide-text normal-case max-h-0 overflow-hidden opacity-0 group-hover:max-h-16 group-hover:opacity-100 group-focus:max-h-16 group-focus:opacity-100 transition-all duration-200 text-[15px] sm:text-[17px] text-[#7C838B] mt-0 group-hover:mt-1 group-focus:mt-1 leading-snug">{s.tagline}</p>{s.custom && <span className="inline-block mt-3 text-[12px] tracking-[0.1em] text-[#7C838B]">YOUR PREVIEW</span>}</button> }

function Creator({ face, glasses, glassesColour, name, view, onFace, onGlasses, onGlassesColour, onName, onView, onCreate }: { face: Face; glasses: Glasses; glassesColour: GlassesColour; name: string; view: string; onFace: (x: Face) => void; onGlasses: (x: Glasses) => void; onGlassesColour: (x: GlassesColour) => void; onName: (x: string) => void; onView: (x: string) => void; onCreate: () => void }) {
  const preview: PreviewStylist = { id: 'preview', name: name || 'Your stylist', tagline: view || 'A point of view made by you', face, glasses, glassesColour, hair: 'bob' }
  return <div className="flex-1 overflow-y-auto px-6 sm:px-10 py-7 grid lg:grid-cols-[minmax(0,1fr)_280px] gap-10"><section>
    <p className="text-[14px] tracking-[0.14em] text-[#7C838B] mb-7">MAKE YOUR STYLIST</p>
    <label className="block text-[16px] tracking-[0.1em] mb-3">NAME YOUR STYLIST</label>
    <input value={name} onChange={(e) => onName(e.target.value)} placeholder="E.G. SUNDAY GIRL" className="w-full bg-white border border-[rgba(43,43,43,0.25)] rounded-full px-6 py-4 text-[18px] text-[#2B2B2B] focus:outline-none" />
    <label className="block text-[16px] tracking-[0.1em] mt-6 mb-3">HER POINT OF VIEW</label>
    <textarea value={view} onChange={(e) => onView(e.target.value)} placeholder="A few words about how she dresses you" className="myra-guide-text normal-case w-full min-h-[90px] bg-white border border-[rgba(43,43,43,0.25)] rounded-2xl px-5 py-4 text-[18px] text-[#2B2B2B] focus:outline-none resize-none" />
    <p className="text-[19px] tracking-[0.08em] mt-8 mb-4">PICK A FACE SHAPE</p>
    <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">{FACE_OPTIONS.map((o) => <FaceShapeOption key={o.value} face={o.value} label={o.label} selected={face === o.value} onClick={() => onFace(o.value)} />)}</div>
    <p className="text-[19px] tracking-[0.08em] mt-8 mb-4">PICK SUNGLASSES</p>
    <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">{GLASSES_OPTIONS.map((o) => <GlassesShapeOption key={o.value} glasses={o.value} label={o.label} selected={glasses === o.value} onClick={() => onGlasses(o.value)} />)}</div>
    <p className="text-[16px] tracking-[0.1em] mt-7 mb-3">PICK A COLOUR</p>
    <div className="flex flex-wrap gap-4">{GLASSES_COLOURS.map((o) => <button key={o.value} onClick={() => onGlassesColour(o.value)} aria-label={o.label} title={o.label} className={`w-12 h-12 rounded-full border-2 transition-transform ${glassesColour === o.value ? 'border-[#2B2B2B] ring-2 ring-white ring-offset-2 ring-offset-[#eeece9] scale-110' : 'border-white'}`} style={{ backgroundColor: o.swatch }} />)}</div>
    <button onClick={onCreate} className="mt-7 bg-[#2B2B2B] text-white rounded-full px-7 py-4 text-[16px] tracking-[0.1em]">CREATE PREVIEW</button>
  </section><aside className="rounded-[28px] bg-white/70 p-7 flex flex-col items-center justify-center min-h-[300px] h-fit sticky top-4"><p className="text-[13px] tracking-[0.14em] text-[#7C838B] mb-5">LIVE PREVIEW</p><StylistAvatar {...preview} size={180} /><p className="mt-6 text-[20px] tracking-[0.08em] text-center">{preview.name}</p><p className="myra-guide-text normal-case text-[16px] text-[#7C838B] text-center mt-2">{preview.tagline}</p></aside></div>
}
function FaceShapeOption({ face, label, selected, onClick }: { face: Face; label: string; selected: boolean; onClick: () => void }) {
  const shape: Record<Face, string> = { round: 'circle', oval: 'rounded-full scale-y-125', triangle: 'rotate-45 rounded-[8px]', diamond: 'rotate-45 rounded-[8px]', rectangle: 'rounded-[14px] scale-x-125' }
  return <button onClick={onClick} aria-label={label} title={label} className={`h-24 rounded-2xl border flex items-center justify-center transition-colors ${selected ? 'border-[#2B2B2B] bg-white ring-2 ring-[#2B2B2B] ring-inset' : 'border-transparent bg-white/45 hover:bg-white'}`}><span className={`w-11 h-11 bg-[#8E8E8E] ${shape[face]}`} /></button>
}
function GlassesShapeOption({ glasses, label, selected, onClick }: { glasses: Glasses; label: string; selected: boolean; onClick: () => void }) {
  const shape = glasses === 'round-white' ? 'rounded-full' : glasses === 'oval-brown' || glasses === 'oval-black' ? 'rounded-full scale-y-75' : glasses === 'square-tortoise' || glasses === 'zebra-square' ? 'rounded-md' : 'rounded-t-full rounded-br-md -skew-x-6'
  const frame = glasses === 'white-black' ? 'border-black bg-white' : glasses === 'zebra-square' ? 'border-black bg-[repeating-linear-gradient(135deg,#171717_0_3px,#eee7d7_3px_7px)]' : glasses === 'black-cateye' ? 'border-black bg-[#171717]' : 'border-[#545454]'
  return <button onClick={onClick} aria-label={label} title={label} className={`h-24 rounded-2xl border flex items-center justify-center transition-colors ${selected ? 'border-[#2B2B2B] bg-white ring-2 ring-[#2B2B2B] ring-inset' : 'border-transparent bg-white/45 hover:bg-white'}`}><span className="flex items-center"><span className={`w-9 h-7 border-[5px] ${frame} ${shape}`} /><span className="w-3 h-[5px] bg-[#545454]" /><span className={`w-9 h-7 border-[5px] ${frame} ${shape}`} /></span></button>
}

function ChatView({ active, avatar, messages, busy, error, draft, quick, test, onDraft, onSend, scroller }: { active: ActiveChat; avatar: PreviewStylist; messages: ChatMessage[]; busy: boolean; error: string | null; draft: string; quick: typeof QUICK; test: boolean; onDraft: (x: string) => void; onSend: (x: string) => void; scroller: React.RefObject<HTMLDivElement> }) {
  const chief = active.kind === 'live' && active.stylist.chief
  const intro = active.kind === 'general' ? 'Search for an outfit, a piece, or a direction. This preview starts fresh and is not attached to a named stylist.' : active.kind === 'custom' ? `This is a preview of ${avatar.name}. Try the voice and direction you have created.` : chief ? 'Ask me who should dress you. I read your pictures, your dressing room and your brands, and I say who.' : 'Tell me where you are going, or what you want to wear, and I will dress you my way.'
  return <><div ref={scroller} data-lenis-prevent className="flex-1 overflow-y-auto px-6 sm:px-8 py-6"><div className="flex items-center gap-4 mb-7"><StylistAvatar {...avatar} size={70} /><p className="myra-guide-text normal-case text-[19px] sm:text-[22px] text-[#55534E] leading-snug">{avatar.tagline}</p></div>{!messages.length && !busy && <p className="myra-guide-text normal-case text-[21px] sm:text-[25px] text-[#55534E] max-w-xl">{intro}</p>}<div className="space-y-5">{messages.map((m) => <Bubble key={m.message_id} m={m} name={avatar.name} />)}{busy && <p className="myra-guide-text normal-case text-[20px] text-[#A8A8A4]">{avatar.name} is thinking…</p>}{error && <p className="myra-guide-text normal-case text-[20px] text-[#B83A3A]">{error}</p>}</div></div><div className="border-t border-[rgba(43,43,43,0.14)] px-6 sm:px-8 pt-4 pb-6 flex-shrink-0 myra-pearl"><div className="flex gap-2 overflow-x-auto pb-3">{quick.map((q) => <button key={q.label} onClick={() => onSend(q.ask)} disabled={busy} className="whitespace-nowrap border border-[rgba(43,43,43,0.25)] rounded-full px-5 py-2.5 text-[15px] tracking-[0.1em] text-[#2B2B2B] hover:bg-[#2B2B2B] hover:text-white disabled:opacity-50">{q.label}</button>)}</div><form onSubmit={(e) => { e.preventDefault(); onSend(draft) }} className="flex items-center gap-2"><input value={draft} onChange={(e) => onDraft(e.target.value)} placeholder={`Ask ${avatar.name}…`} className="myra-guide-text normal-case flex-1 bg-white border border-[rgba(43,43,43,0.25)] rounded-full px-6 py-4 text-[19px] text-[#2B2B2B] placeholder:text-[#A8A8A4] focus:outline-none" /><button type="submit" disabled={busy || !draft.trim()} aria-label="Send" className="w-14 h-14 rounded-full bg-[#2B2B2B] text-white flex items-center justify-center hover:bg-[#0A0A0A] disabled:opacity-40"><SendIcon className="w-6 h-6" /></button></form>{test && <p className="text-[14px] tracking-[0.1em] text-[#7C838B] mt-3">TESTING AS HER — NOTHING IS KEPT</p>}</div></>
}

function Bubble({ m, name }: { m: ChatMessage; name: string }) { const mine = m.role === 'member'; return <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[92%] ${mine ? '' : 'w-full'}`}>{!mine && <p className="text-[14px] tracking-[0.14em] text-[#7C838B] mb-1">{name}</p>}<p className={`myra-guide-text normal-case text-[19px] sm:text-[22px] leading-relaxed whitespace-pre-wrap rounded-[22px] px-6 py-4 ${mine ? 'bg-[#2B2B2B] text-white' : 'bg-white/85 text-[#2B2B2B] shadow-[0_2px_14px_rgba(43,43,43,0.08)]'}`}>{m.body}</p>{!!m.looks?.length && <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">{m.looks.map((l) => <ComposedLookCard key={l.look_id} look={l as any} />)}</div>}{!!m.items?.length && <div className="grid grid-cols-3 lg:grid-cols-4 gap-4 mt-5">{m.items.map((it) => <a key={it.item_id} href={it.url ?? undefined} target="_blank" rel="noreferrer" className="bg-white/85 rounded-[12px] overflow-hidden shadow-[0_2px_14px_rgba(43,43,43,0.08)]"><div className="relative aspect-[3/4] bg-white">{it.image_url && <FallbackImage src={it.image_url} thumbWidth={300} alt={it.name} className="absolute inset-0 w-full h-full object-contain" />}</div><div className="px-2 py-2"><p className="text-[14px] tracking-[0.1em] text-[#0A0A0A] truncate">{it.brand}</p><p className="myra-guide-text normal-case text-[16px] text-[#55534E] leading-snug line-clamp-2">{it.name}</p></div></a>)}</div>}</div></div> }

function StylistAvatar({ name, face, glasses, glassesColour, hair, size }: Pick<PreviewStylist, 'name' | 'face' | 'glasses' | 'glassesColour' | 'hair'> & { size: number }) {
  const facePath: Record<Face, string> = {
    round: 'M50 20c20 0 32 13 32 32 0 17-7 31-18 37L50 93 36 89C25 83 18 69 18 52c0-19 12-32 32-32Z',
    oval: 'M50 18c18 0 28 15 28 34 0 17-6 31-17 37L50 94 39 89C28 83 22 69 22 52c0-19 10-34 28-34Z',
    triangle: 'M50 19c22 0 32 14 29 33-2 17-10 31-22 39L50 94 43 90C31 82 23 68 21 51c-3-19 7-32 29-32Z',
    diamond: 'M50 18c17 0 29 14 29 34 0 17-8 32-21 40L50 95 42 91C29 83 21 69 21 51c0-20 12-34 29-34Z',
    rectangle: 'M25 22c0-7 8-11 25-11s25 4 25 11v34c0 17-6 30-17 37l-8 3-8-3C31 86 25 73 25 56V22Z',
  }
  const palette: Record<GlassesColour, { frame: string; tint: string }> = {
    cream: { frame: '#F5F0E6', tint: '#9A7048' }, tortoise: { frame: '#72472D', tint: '#A87747' },
    black: { frame: '#191517', tint: '#8B714D' }, cherry: { frame: '#A7373C', tint: '#A65F55' },
    cobalt: { frame: '#2455A6', tint: '#5875A5' }, lime: { frame: '#A8BE3B', tint: '#A9A655' },
  }
  const { frame, tint } = palette[glassesColour]
  const activeFrame = glasses === 'white-black' || glasses === 'black-cateye' ? '#171517' : glasses === 'zebra-square' ? '#24201E' : frame
  const activeTint = glasses === 'white-black' || glasses === 'black-cateye' ? '#3F302B' : glasses === 'zebra-square' ? '#9A7048' : tint
  const hairPaint = name === 'Mila'
    ? { fill: '#201815', highlight: '#4A332D' }
    : name === 'The Parisienne'
      ? { fill: '#8A5B42', highlight: '#BC8A67' }
      : name === 'Scandi-Mum'
        ? { fill: '#C59A58', highlight: '#E7C784' }
        : { fill: '#3A2924', highlight: '#826156' }
  const lenses = glasses === 'white-black' ? <><path d="m8 52 11-23 28 8-7 26-24-3Z" /><path d="m92 52-11-23-28 8 7 26 24-3Z" /></>
    : glasses === 'zebra-square' ? <><path d="m10 34 35 3-3 29-28-3Z" /><path d="m90 34-35 3 3 29 28-3Z" /></>
      : glasses === 'black-cateye' ? <><path d="m9 54 9-24 29 8-6 29-25-2Z" /><path d="m91 54-9-24-29 8 6 29 25-2Z" /></>
    : glasses === 'round-white' ? <><circle cx="29" cy="48" r="18" /><circle cx="71" cy="48" r="18" /></>
    : glasses === 'oval-brown' ? <><ellipse cx="30" cy="48" rx="21" ry="14" /><ellipse cx="70" cy="48" rx="21" ry="14" /></>
      : glasses === 'square-tortoise' ? <><path d="m10 34 35 3-3 29-28-3Z" /><path d="m90 34-35 3 3 29 28-3Z" /></>
        : glasses === 'cat-eye' ? <><path d="m9 54 9-24 29 8-6 29-25-2Z" /><path d="m91 54-9-24-29 8 6 29 25-2Z" /></>
          : <><path d="M4 45c2-13 13-20 27-19 11 1 18 7 20 15-2 13-11 22-24 22C13 63 4 56 4 45Z" /><path d="M96 45c-2-13-13-20-27-19-11 1-18 7-20 15 2 13 11 22 24 22 14 0 23-7 23-18Z" /></>
  const hairBack = hair === 'long' ? <path d="M18 92c-7-22-5-51 7-72C32 10 41 6 50 6s18 4 25 14c12 21 14 50 7 72l-13-7V42H31v43Z" fill={hairPaint.fill} />
    : hair === 'bob' ? <path d="M12 78c-4-20-1-46 11-61C30 9 40 6 50 6s20 3 27 11c12 15 15 41 11 61l-17 5V38H29v45Z" fill={hairPaint.fill} />
      : <><ellipse cx="71" cy="15" rx="15" ry="14" fill={hairPaint.fill} /><path d="M18 65c-4-20 0-42 10-53C34 7 42 5 51 6c14 1 24 9 29 22 5 12 4 25 1 37l-13-9V37H32v19Z" fill={hairPaint.fill} /></>
  const updoFringe = name === 'The Corporate Girl'
    ? <><path d="M18 44C18 22 31 8 50 8c19 0 32 14 32 36-9-6-17-8-25-7-11 2-20 7-39 7Z" fill={hairPaint.fill} /><path d="M51 10c-3 9-2 18 1 27" fill="none" stroke={hairPaint.highlight} strokeWidth="1.2" strokeLinecap="round" /></>
    : <><path d="M24 39C27 20 38 10 51 10c14 0 24 10 27 26-9-7-17-8-27-5-10 3-17 7-27 8Z" fill={hairPaint.fill} /><path d="M51 11c-3 8-2 16 1 24" fill="none" stroke={hairPaint.highlight} strokeWidth="1.2" strokeLinecap="round" /></>
  const fringe = hair === 'long' ? <><path d="M20 38c2-17 14-29 30-29 14 0 24 8 30 22-10-7-19-9-28-6-11 4-20 11-32 13Z" fill={hairPaint.fill} /><path d="M50 10c-4 8-4 16-1 25" fill="none" stroke={hairPaint.highlight} strokeWidth="1.2" strokeLinecap="round" /></>
    : hair === 'bob' ? <><path d="M17 39C21 19 34 9 50 9c15 0 27 10 33 27-12-7-22-8-32-5-10 3-20 8-34 8Z" fill={hairPaint.fill} /><path d="M51 10c-3 9-2 17 1 25" fill="none" stroke={hairPaint.highlight} strokeWidth="1.2" strokeLinecap="round" /></>
      : updoFringe
  return <div className="overflow-hidden flex-shrink-0" style={{ width: size, height: size }} aria-label={`${name} avatar`} role="img">
    <svg viewBox="0 0 100 100" className="w-full h-full">
      {hairBack}
      <path d={facePath[face]} fill="#D7A27E" />
      {fringe}
      <g fill="none" stroke="#392521" strokeWidth="1.7" strokeLinecap="round"><path d="M18 50c5-4 11-4 16 0" /><path d="M66 50c5-4 11-4 16 0" /></g>
      <g fill="#2B211F"><ellipse cx="28" cy="49" rx="2.1" ry="2.8" /><ellipse cx="72" cy="49" rx="2.1" ry="2.8" /></g>
      <path d="M49 53c-2 6-2 9 2 10" fill="none" stroke="#A36958" strokeWidth="1.25" strokeLinecap="round" />
      {glasses === 'white-black' && <g fill="none" stroke="#F5F0E6" strokeWidth="10" strokeLinejoin="round">{lenses}</g>}
      <g fill="none" stroke={activeFrame} strokeLinecap="round"><path d={glasses === 'round-white' ? 'M45 49c2-4 8-4 10 0' : 'M44 48c2-1.5 10-1.5 12 0'} strokeWidth="3.2" /><path d="M12 46 3 42M88 46l9-4" strokeWidth="2.5" /></g>
      <g fill={activeTint} fillOpacity=".7" stroke={activeFrame} strokeWidth={glasses === 'white-black' ? 3.8 : 5} strokeLinejoin="round">{lenses}</g>
      {glasses === 'zebra-square' && <g fill="none" stroke="#F3EBD9" strokeWidth="2.2" opacity=".95"><path d="m11 38 13 5m-9 6 16 6m-14 5 13 5m48-27-13 5m9 6-16 6m14 5-13 5" /></g>}
      <path d="M43 76c2.1-2.7 4.5-3 7-1 2.5-2 4.9-1.7 7 1-2 3.5-4.3 4.8-7 4.8S45 79.5 43 76Z" fill="#D9434A" stroke="#8B3A3B" strokeWidth=".9" strokeLinejoin="round" />
      <path d="M44 76c2.2.6 4 .3 6-1.1 2 1.4 3.8 1.7 6 1.1" fill="none" stroke="#88383C" strokeWidth=".85" strokeLinecap="round" />
    </svg>
  </div>
}
function SpeechIcon({ className }: { className?: string }) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M4 5.5h16v10H9l-5 4v-4H4z" /></svg> }
function SendIcon({ className }: { className?: string }) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M4 12h15M13 6l6 6-6 6" /></svg> }
