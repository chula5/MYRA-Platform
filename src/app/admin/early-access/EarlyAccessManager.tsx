'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createEarlyAccessUser, deleteEarlyAccessUser, type EarlyAccessUser } from './actions'

const inputClass =
  'w-full border border-[#E2E0DB] bg-white px-4 py-2.5 text-[12px] tracking-[0.10em] text-[#0A0A0A] focus:outline-none focus:border-[#0A0A0A] transition-colors'

function randomPassword(): string {
  // Readable-ish 12-char password (avoids ambiguous chars).
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  let out = ''
  const arr = new Uint32Array(12)
  crypto.getRandomValues(arr)
  for (let i = 0; i < 12; i++) out += chars[arr[i] % chars.length]
  return out
}

export default function EarlyAccessManager({ initialUsers }: { initialUsers: EarlyAccessUser[] }) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    setCreated(null)
    const res = await createEarlyAccessUser(email, password)
    setBusy(false)
    if (res.error) { setError(res.error); return }
    setCreated({ email: email.trim().toLowerCase(), password })
    setEmail('')
    setPassword('')
    router.refresh()
  }

  async function handleDelete(id: string) {
    if (deletingId) return
    setDeletingId(id)
    const res = await deleteEarlyAccessUser(id)
    setDeletingId(null)
    if (res.error) { setError(res.error); return }
    router.refresh()
  }

  async function copyCreds() {
    if (!created) return
    try {
      await navigator.clipboard.writeText(
        `MYRA early access\nmyraassistant.co.uk/earlyaccess\nEmail: ${created.email}\nPassword: ${created.password}`,
      )
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch { /* ignore */ }
  }

  return (
    <div>
      {/* Create form */}
      <div className="border border-[#E2E0DB] bg-white rounded-[3px] p-6 mb-8 max-w-[560px]">
        <p className="text-[10px] tracking-[0.25em] text-[#6B6B6B] mb-4">CREATE A LOGIN</p>
        <form onSubmit={handleCreate} className="space-y-3">
          <input
            type="email"
            placeholder="EMAIL"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
            required
          />
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="PASSWORD (MIN 8 CHARS)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
              required
              minLength={8}
            />
            <button
              type="button"
              onClick={() => setPassword(randomPassword())}
              className="shrink-0 border border-[#E2E0DB] text-[#6B6B6B] px-4 text-[10px] tracking-[0.18em] hover:border-[#0A0A0A] hover:text-[#0A0A0A] transition-colors"
            >
              GENERATE
            </button>
          </div>
          {error && <p className="text-[10px] tracking-[0.15em] text-[#B83A3A]">{error.toUpperCase()}</p>}
          <button
            type="submit"
            disabled={busy}
            className="bg-[#0A0A0A] text-white px-6 py-2.5 text-[10px] tracking-[0.20em] hover:bg-[#333] transition-colors duration-300 disabled:opacity-40"
          >
            {busy ? 'CREATING…' : 'CREATE LOGIN →'}
          </button>
        </form>

        {created && (
          <div className="mt-5 border border-green-300 bg-green-50 p-4 rounded-[3px]">
            <p className="text-[10px] tracking-[0.18em] text-green-800 mb-2">✓ LOGIN CREATED — SHARE THESE DETAILS</p>
            <p className="text-[11px] tracking-[0.10em] text-[#0A0A0A]">myraassistant.co.uk/earlyaccess</p>
            <p className="text-[11px] tracking-[0.10em] text-[#0A0A0A] mt-1">Email: {created.email}</p>
            <p className="text-[11px] tracking-[0.10em] text-[#0A0A0A]">Password: {created.password}</p>
            <p className="text-[9px] tracking-[0.12em] text-[#6B6B6B] mt-2">
              The password is only shown here — copy it now (it can&rsquo;t be retrieved later, only reset).
            </p>
            <button
              type="button"
              onClick={copyCreds}
              className="mt-3 border border-[#0A0A0A] text-[#0A0A0A] px-4 py-2 text-[10px] tracking-[0.18em] hover:bg-[#0A0A0A] hover:text-white transition-colors"
            >
              {copied ? '✓ COPIED' : 'COPY DETAILS'}
            </button>
          </div>
        )}
      </div>

      {/* Existing users */}
      <p className="text-[10px] tracking-[0.25em] text-[#6B6B6B] mb-4">
        {initialUsers.length} EARLY-ACCESS {initialUsers.length === 1 ? 'PERSON' : 'PEOPLE'}
      </p>
      {initialUsers.length === 0 ? (
        <p className="text-[10px] tracking-[0.15em] text-[#A8A8A4]">NO LOGINS YET.</p>
      ) : (
        <div className="border border-[#E2E0DB] rounded-[3px] overflow-hidden">
          {initialUsers.map((u, i) => (
            <div
              key={u.id}
              className={`flex items-center justify-between gap-4 px-5 py-3 bg-white ${i > 0 ? 'border-t border-[#E2E0DB]' : ''}`}
            >
              <div className="min-w-0">
                <p className="text-[12px] tracking-[0.08em] text-[#0A0A0A] truncate">{u.email}</p>
                <p className="text-[9px] tracking-[0.15em] text-[#A8A8A4] mt-0.5">
                  ADDED {new Date(u.created_at).toLocaleDateString('en-GB')}
                  {' · '}
                  {u.last_sign_in_at
                    ? `LAST IN ${new Date(u.last_sign_in_at).toLocaleDateString('en-GB')}`
                    : 'NEVER SIGNED IN'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleDelete(u.id)}
                disabled={deletingId === u.id}
                className="shrink-0 text-[9px] tracking-[0.18em] text-[#A8A8A4] hover:text-[#B83A3A] border border-[#E2E0DB] hover:border-[#B83A3A] px-3 py-1.5 transition-colors disabled:opacity-40"
              >
                {deletingId === u.id ? 'REVOKING…' : 'REVOKE'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
