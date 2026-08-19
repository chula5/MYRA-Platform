'use client'

// PILOT CLIENTS — create them, watch the persona fade, read the disagreements.
//
// The disagreement list is the point of the pilot: uploads that sit furthest
// outside the persona envelope are where the assignment was wrong, and that's
// the finding worth having.

import { useEffect, useState } from 'react'
import {
  createClient,
  listClients,
  loadClientDetail,
  reassignClientPersona,
  type ClientRow,
  type ClientDetail,
} from './client-actions'
import { PERSONA_FLOOR_WEIGHT, PERSONA_START_WEIGHT } from '@/lib/user-persona'
import { PRICE_BANDS, HEEL_OPTIONS, LENGTH_NO_GO_OPTIONS } from '@/lib/style-profile'
import { NARRATED_DIMS } from '@/lib/inspiration'

const DIM_LABEL = new Map(NARRATED_DIMS.map((d) => [d.index, d.label]))
const HEEL_LABEL = new Map(HEEL_OPTIONS.map((o) => [o.value, o.label]))
const NO_GO_LABEL = new Map(LENGTH_NO_GO_OPTIONS.map((o) => [o.value, o.label]))

export default function ClientsPanel({
  personas,
}: {
  personas: { stylist_id: string; name: string }[]
}) {
  const [clients, setClients] = useState<ClientRow[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [invite, setInvite] = useState<{ url: string; password: string; email: string } | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ClientDetail | null>(null)

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [personaId, setPersonaId] = useState('')

  async function refresh() {
    const r = await listClients()
    setClients(r.clients)
    if (r.error) setMsg(r.error.toUpperCase())
  }
  useEffect(() => { void refresh() }, [])

  async function openClient(userId: string) {
    if (openId === userId) { setOpenId(null); setDetail(null); return }
    setOpenId(userId)
    setDetail(null)
    setDetail(await loadClientDetail(userId))
  }

  return (
    <div className="border border-[#E2E0DB] bg-white rounded-[14px] p-5">
      <p className="text-[12px] tracking-[0.14em] text-[#0A0A0A] mb-1">PILOT CLIENTS</p>
      <p className="text-[9px] tracking-[0.05em] text-[#A8A8A4] mb-4 max-w-2xl leading-relaxed">
        A client signs in at /me — her profile and her uploads, nothing else. The client role grants no admin access.
        Her persona starts at {PERSONA_START_WEIGHT} and decays toward {PERSONA_FLOOR_WEIGHT} as she behaves: a prior that fades, never a bucket.
      </p>

      {/* Create */}
      <div className="flex flex-wrap gap-2 items-center mb-3">
        <input
          value={name} onChange={(e) => setName(e.target.value)} placeholder="NAME"
          className="border border-[#E2E0DB] px-3 py-2 text-[10px] tracking-[0.06em] outline-none focus:border-[#0A0A0A] w-40"
        />
        <input
          value={email} onChange={(e) => setEmail(e.target.value)} placeholder="EMAIL"
          className="border border-[#E2E0DB] px-3 py-2 text-[10px] tracking-[0.06em] outline-none focus:border-[#0A0A0A] w-56"
        />
        <select
          value={personaId} onChange={(e) => setPersonaId(e.target.value)}
          className="border border-[#E2E0DB] px-3 py-2 text-[10px] tracking-[0.06em] outline-none focus:border-[#0A0A0A]"
        >
          <option value="">ASSIGN A PERSONA…</option>
          {personas.map((p) => <option key={p.stylist_id} value={p.stylist_id}>{p.name.toUpperCase()}</option>)}
        </select>
        <button
          disabled={!!busy || !name.trim() || !email.trim() || !personaId}
          onClick={async () => {
            setBusy('create'); setMsg(null)
            const r = await createClient(name, email, personaId)
            setBusy(null)
            if (r.error) setMsg(r.error.toUpperCase())
            else {
              setInvite({ url: r.inviteUrl!, password: r.password!, email: email.trim().toLowerCase() })
              setName(''); setEmail(''); setPersonaId('')
              setMsg('CLIENT CREATED — SHARE THE DETAILS BELOW')
              await refresh()
            }
          }}
          className="bg-[#0A0A0A] text-white px-4 py-2 text-[9px] tracking-[0.12em] rounded-full hover:opacity-85 disabled:opacity-40"
        >
          {busy === 'create' ? 'CREATING…' : 'CREATE CLIENT'}
        </button>
        {msg && <span className="text-[9px] tracking-[0.1em] text-[#C4A882]">{msg}</span>}
      </div>

      {/* Invite details — no email infrastructure for the pilot, share by hand */}
      {invite && (
        <div className="border border-[#E8D9B8] bg-[#FBF8F2] px-4 py-3 mb-4">
          <p className="text-[9px] tracking-[0.14em] text-[#8B5E00] mb-2">SEND HER THESE THREE THINGS</p>
          <p className="text-[11px] tracking-[0.04em] text-[#4A4E57]">LINK: {invite.url}</p>
          <p className="text-[11px] tracking-[0.04em] text-[#4A4E57]">EMAIL: {invite.email}</p>
          <p className="text-[11px] tracking-[0.04em] text-[#4A4E57]">PASSWORD: {invite.password}</p>
          <button
            onClick={() => {
              void navigator.clipboard.writeText(`${invite.url}\nEmail: ${invite.email}\nPassword: ${invite.password}`)
              setMsg('COPIED')
            }}
            className="mt-2 border border-[#E2E0DB] px-3 py-1.5 text-[9px] tracking-[0.1em] text-[#6B6B6B] hover:border-[#0A0A0A]"
          >
            ⎘ COPY
          </button>
        </div>
      )}

      {/* List */}
      {clients.length === 0 ? (
        <p className="text-[9px] tracking-[0.1em] text-[#A8A8A4]">NO CLIENTS YET.</p>
      ) : (
        <div className="space-y-2">
          {clients.map((c) => (
            <div key={c.user_id} className="border border-[#EFEDE9]">
              <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="text-[12px] tracking-[0.06em] text-[#0A0A0A]">{c.name.toUpperCase()}</span>
                <span className="text-[9px] tracking-[0.06em] text-[#A8A8A4]">{c.email}</span>
                <span className="text-[9px] tracking-[0.1em] text-[#6B6B6B] border border-[#E2E0DB] px-2 py-0.5">
                  {c.persona_name?.toUpperCase() ?? 'NO PERSONA'}
                </span>
                {c.weight != null && (
                  <span className="text-[9px] tracking-[0.1em] text-[#4A6FA5]" title="Persona weight — decays with behaviour">
                    WEIGHT {c.weight.toFixed(2)}
                  </span>
                )}
                <span className="text-[9px] tracking-[0.08em] text-[#A8A8A4]">
                  {c.behavioural_events} BEHAVIOURAL · {c.uploads} UPLOADS
                </span>
                <button
                  onClick={() => openClient(c.user_id)}
                  className="ml-auto border border-[#E2E0DB] px-3 py-1.5 text-[9px] tracking-[0.1em] text-[#6B6B6B] hover:border-[#0A0A0A]"
                >
                  {openId === c.user_id ? 'CLOSE' : 'OPEN'}
                </button>
              </div>

              {openId === c.user_id && (
                <div className="px-4 pb-4">
                  {!detail && <p className="text-[9px] tracking-[0.1em] text-[#A8A8A4]">LOADING…</p>}
                  {detail && <ClientDetailView d={detail} personas={personas} userId={c.user_id} onReassigned={refresh} />}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ClientDetailView({
  d,
  personas,
  userId,
  onReassigned,
}: {
  d: ClientDetail
  personas: { stylist_id: string; name: string }[]
  userId: string
  onReassigned: () => void
}) {
  const p = d.profile
  const disagreements = [...d.uploads].sort((a, b) => b.distance - a.distance).slice(0, 8)
  const spend = p?.price_comfort?.length === 2
    ? [PRICE_BANDS.find((b) => b.tier === p.price_comfort![0])?.label, PRICE_BANDS.find((b) => b.tier === p.price_comfort![1])?.label].filter(Boolean).join(' → ')
    : null

  return (
    <div className="space-y-4">
      {/* Style profile — hard vs soft, same split as /admin/signup-preferences */}
      <div>
        <p className="text-[9px] tracking-[0.14em] text-[#A8A8A4] mb-1.5">STYLE PROFILE</p>
        {!p ? (
          <p className="text-[9px] tracking-[0.08em] text-[#A8A8A4]">SHE HASN&rsquo;T DONE THE QUESTIONNAIRE YET.</p>
        ) : (
          <div className="space-y-1.5">
            <div className="border-l-2 border-[#B83A3A] pl-3 flex flex-wrap gap-x-5 gap-y-1">
              {p.colour_never?.length ? <Fact k="NEVER WEARS" v={p.colour_never.join(', ')} /> : null}
              {p.length_no_go?.length ? <Fact k="WON’T WEAR" v={p.length_no_go.map((x) => NO_GO_LABEL.get(x) ?? x).join(' · ')} /> : null}
              {p.heel_preference && p.heel_preference !== 'any' ? <Fact k="HEELS" v={HEEL_LABEL.get(p.heel_preference) ?? ''} /> : null}
              {spend ? <Fact k="SPEND" v={spend} /> : null}
            </div>
            <div className="border-l-2 border-[#E2E0DB] pl-3 flex flex-wrap gap-x-5 gap-y-1">
              {p.colour_loved?.length ? <Fact k="GRAVITATES TO" v={p.colour_loved.join(', ')} /> : null}
              {p.fit_top != null ? <Fact k="FIT TOP" v={String(p.fit_top)} /> : null}
              {p.pattern_appetite != null ? <Fact k="PATTERN" v={String(p.pattern_appetite)} /> : null}
              {p.notes ? <Fact k="FOR THE STYLIST" v={p.notes} /> : null}
            </div>
          </div>
        )}
      </div>

      {/* Persona weight over time */}
      <div>
        <p className="text-[9px] tracking-[0.14em] text-[#A8A8A4] mb-1.5">
          PERSONA WEIGHT OVER TIME {d.personaName ? `· ${d.personaName.toUpperCase()}` : ''}
        </p>
        {d.weightHistory.length === 0 ? (
          <p className="text-[9px] tracking-[0.08em] text-[#A8A8A4]">NO HISTORY YET.</p>
        ) : (
          <div className="flex items-end gap-1 h-12">
            {d.weightHistory.map((h, i) => (
              <div
                key={i}
                className="w-4 bg-[#4A6FA5]"
                style={{ height: `${Math.max(4, h.weight * 100)}%` }}
                title={`${h.weight.toFixed(2)} after ${h.event_count} behavioural events`}
              />
            ))}
            <span className="text-[9px] tracking-[0.08em] text-[#6B6B6B] ml-2 self-center">
              NOW {d.weight?.toFixed(2) ?? '—'}
            </span>
          </div>
        )}
        <div className="flex gap-2 mt-2">
          <select
            defaultValue=""
            onChange={async (e) => { if (e.target.value) { await reassignClientPersona(userId, e.target.value); onReassigned() } }}
            className="border border-[#E2E0DB] px-2 py-1 text-[9px] tracking-[0.08em] outline-none"
          >
            <option value="">REASSIGN PERSONA…</option>
            {personas.map((x) => <option key={x.stylist_id} value={x.stylist_id}>{x.name.toUpperCase()}</option>)}
          </select>
        </div>
      </div>

      {/* Disagreement view — the pilot's most important output */}
      <div>
        <p className="text-[9px] tracking-[0.14em] text-[#B83A3A] mb-1.5">
          DISAGREEMENT · UPLOADS FURTHEST OUTSIDE THE PERSONA
        </p>
        {disagreements.length === 0 ? (
          <p className="text-[9px] tracking-[0.08em] text-[#A8A8A4]">NO UPLOADS YET.</p>
        ) : (
          <div className="grid grid-cols-4 md:grid-cols-6 gap-2">
            {disagreements.map((u) => (
              <div key={u.image_id} className="border border-[#E2E0DB]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={u.image_url} alt="" className="w-full aspect-[3/4] object-cover bg-[#F8F8F6]" />
                <div className="px-1.5 py-1">
                  <p className={`text-[8px] tracking-[0.08em] ${u.distance > 1.5 ? 'text-[#B83A3A]' : 'text-[#6B6B6B]'}`}>
                    {u.distance.toFixed(2)}σ OUT
                  </p>
                  {u.worst.slice(0, 2).map((w) => (
                    <p key={w.dim} className="text-[7px] tracking-[0.06em] text-[#A8A8A4]">
                      {DIM_LABEL.get(w.dim) ?? `D${w.dim}`} {w.sigma.toFixed(1)}
                    </p>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="text-[8px] tracking-[0.06em] text-[#A8A8A4] mt-1.5 leading-relaxed">
          High values mean she is drawn to things the persona wouldn&rsquo;t pick. A consistent pattern here is a
          reassignment, or a persona whose envelope is wrong.
        </p>
      </div>
    </div>
  )
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <span className="text-[9px] tracking-[0.045em] text-[#4A4E57]">
      <span className="text-[#A8A8A4]">{k}:</span> {v.toUpperCase()}
    </span>
  )
}
