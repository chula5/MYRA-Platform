'use client'

import { useState } from 'react'
import { draftNow, saveNote, sendTest, sendToMembers, skipNote } from './actions'
import type { NewBrandsNote, NoteBrand } from '@/lib/new-brands-note'

const BTN = 'px-5 py-2.5 text-[13px] tracking-[0.12em] rounded-full disabled:opacity-40 transition-opacity'
const FIELD = 'w-full rounded-xl border border-[#E2E0DB] bg-white px-4 py-3 text-[16px] text-[#2B2B2B] outline-none focus:border-[#7C838B]'
const LABEL = 'text-[12px] tracking-[0.12em] text-[#7C838B] uppercase'

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : ''

export default function NewBrandsClient({ notes, previews, notMigrated }: {
  notes: NewBrandsNote[]
  previews: Record<string, string>
  notMigrated: boolean
}) {
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const draft = notes.find((n) => n.status === 'draft')
  const past = notes.filter((n) => n !== draft)

  async function makeDraft() {
    setBusy(true)
    const r = await draftNow()
    setBusy(false)
    if (r.error) setMsg({ text: r.error, bad: true })
    else if (r.empty) setMsg({ text: 'No brands were added to the picker in the last seven days, so there is nothing to send.' })
  }

  return (
    <div className="px-6 py-8 max-w-[1400px]">
      <h1 className="text-[28px] text-[#2B2B2B]">New brands this week</h1>
      <p className="mt-2 text-[16px] text-[#55534E] max-w-[760px]">
        Every Saturday night MYRA drafts a note about the brands added to the brand picker that week. Read it, change anything,
        then SEND: a note in the app, a push where they said yes, and an email. Each member only hears about brands she has not
        already loved or turned down. Nothing goes out until you press SEND.
      </p>
      {notMigrated && <p className="mt-4 text-[15px] text-[#9B3A3A]">Migration 0115 has not been applied yet.</p>}
      {msg && <p className={`mt-4 text-[15px] ${msg.bad ? 'text-[#9B3A3A]' : 'text-[#55534E]'}`}>{msg.text}</p>}

      {draft
        ? <Draft key={draft.note_id} note={draft} preview={previews[draft.note_id]} say={setMsg} />
        : (
          <div className="mt-8">
            <p className="text-[16px] text-[#55534E]">No note waiting. The next one is drafted on Saturday night.</p>
            <button type="button" disabled={busy || notMigrated} onClick={makeDraft} className={`${BTN} mt-4 bg-[#2B2B2B] text-white`}>
              {busy ? 'DRAFTING…' : 'DRAFT ONE NOW'}
            </button>
          </div>
        )}

      {past.length > 0 && (
        <div className="mt-12">
          <p className={LABEL}>Earlier weeks</p>
          <ul className="mt-3 space-y-2">
            {past.map((n) => (
              <li key={n.note_id} className="text-[15px] text-[#55534E]">
                Week to {fmt(n.week_of)} · {n.brands.length} brands · {n.status === 'sent'
                  ? `sent ${fmt(n.sent_at)}${n.sent_report ? ` — ${(n.sent_report as any).told ?? 0} told, ${(n.sent_report as any).pushed ?? 0} pushed, ${(n.sent_report as any).emailed ?? 0} emailed` : ''}`
                  : n.status}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function Draft({ note, preview, say }: { note: NewBrandsNote; preview: string; say: (m: { text: string; bad?: boolean } | null) => void }) {
  const [title, setTitle] = useState(note.title)
  const [body, setBody] = useState(note.body)
  const [intro, setIntro] = useState(note.email_intro)
  const [brands, setBrands] = useState<NoteBrand[]>(note.brands)
  const [removed, setRemoved] = useState<NoteBrand[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const dirty = title !== note.title || body !== note.body || intro !== note.email_intro || brands.length !== note.brands.length

  const remove = (b: NoteBrand) => { setBrands((x) => x.filter((y) => y.brand_id !== b.brand_id)); setRemoved((r) => [...r, b]) }
  const undo = () => { const last = removed[removed.length - 1]; if (!last) return; setRemoved((r) => r.slice(0, -1)); setBrands((x) => [...x, last].sort((a, b) => a.name.localeCompare(b.name))) }

  async function save(): Promise<boolean> {
    setBusy('save')
    const r = await saveNote(note.note_id, { title, body, email_intro: intro, brands })
    setBusy(null)
    if (r.error) { say({ text: r.error, bad: true }); return false }
    return true
  }

  async function test() {
    if (dirty && !(await save())) return
    setBusy('test')
    const r = await sendTest(note.note_id)
    setBusy(null)
    say(r.error ? { text: r.error, bad: true } : { text: `A sample email went to ${r.to}. No member has been told.` })
  }

  async function send() {
    if (!window.confirm(`Send to every member now?\n\nA note in the app, a push where they said yes, and an email — about ${brands.length} brand${brands.length === 1 ? '' : 's'}.`)) return
    if (dirty && !(await save())) return
    setBusy('send')
    const r = await sendToMembers(note.note_id)
    setBusy(null)
    const rep = (r.report ?? {}) as any
    say(r.error ? { text: r.error, bad: true } : { text: `Sent. ${rep.told ?? 0} members told in the app, ${rep.pushed ?? 0} pushes, ${rep.emailed ?? 0} emails.` })
  }

  async function skip() {
    if (!window.confirm('Skip this week? Nothing will be sent.')) return
    setBusy('skip')
    const r = await skipNote(note.note_id)
    setBusy(null)
    if (r.error) say({ text: r.error, bad: true })
  }

  return (
    <div className="mt-8 grid grid-cols-1 xl:grid-cols-2 gap-10">
      <div className="space-y-6">
        <p className="text-[16px] text-[#2B2B2B]">Week to {fmt(note.week_of)} · drafted {fmt(note.created_at)}</p>

        <div>
          <p className={LABEL}>Brands ({brands.length})</p>
          <div className="mt-3 flex flex-wrap gap-2.5">
            {brands.map((b) => (
              <span key={b.brand_id} className="inline-flex items-center gap-2 rounded-full bg-[#2B2B2B] text-white px-4 py-2 text-[15px]">
                {b.name}<span className="text-[12px] text-[#C9C9C9]">{b.group_name}</span>
                <button type="button" onClick={() => remove(b)} aria-label={`Remove ${b.name}`} className="opacity-70 hover:opacity-100">×</button>
              </span>
            ))}
            {removed.length > 0 && (
              <button type="button" onClick={undo} className="text-[14px] text-[#7C838B] underline underline-offset-4">undo</button>
            )}
          </div>
        </div>

        <label className="block">
          <span className={LABEL}>Notification title (and email subject)</span>
          <input className={`${FIELD} mt-2`} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="block">
          <span className={LABEL}>Notification line</span>
          <textarea className={`${FIELD} mt-2`} rows={2} value={body} onChange={(e) => setBody(e.target.value)} />
        </label>
        <label className="block">
          <span className={LABEL}>Email opening</span>
          <textarea className={`${FIELD} mt-2`} rows={4} value={intro} onChange={(e) => setIntro(e.target.value)} />
        </label>

        <div className="flex flex-wrap gap-3 pt-2">
          <button type="button" disabled={!!busy || !brands.length} onClick={send} className={`${BTN} bg-[#2B2B2B] text-white`}>
            {busy === 'send' ? 'SENDING…' : 'SEND TO MEMBERS'}
          </button>
          <button type="button" disabled={!!busy} onClick={test} className={`${BTN} bg-white text-[#2B2B2B] border border-[#E2E0DB]`}>
            {busy === 'test' ? 'SENDING…' : 'EMAIL ME A SAMPLE'}
          </button>
          <button type="button" disabled={!!busy || !dirty} onClick={async () => { if (await save()) say({ text: 'Saved.' }) }} className={`${BTN} bg-white text-[#2B2B2B] border border-[#E2E0DB]`}>
            {busy === 'save' ? 'SAVING…' : 'SAVE'}
          </button>
          <button type="button" disabled={!!busy} onClick={skip} className={`${BTN} text-[#9B3A3A]`}>SKIP THIS WEEK</button>
        </div>
      </div>

      <div>
        <p className={LABEL}>On her phone</p>
        <div className="mt-3 rounded-2xl bg-[#EFEFF1] p-4 max-w-[420px]">
          <p className="text-[15px] font-semibold text-[#2B2B2B]">{title}</p>
          <p className="text-[15px] text-[#55534E]">{body}</p>
        </div>
        <p className={`${LABEL} mt-8`}>The email (as last saved)</p>
        <iframe title="Email preview" srcDoc={preview} className="mt-3 w-full h-[640px] rounded-xl border border-[#E2E0DB] bg-white" />
      </div>
    </div>
  )
}
