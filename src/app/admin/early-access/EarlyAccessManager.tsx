'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createEarlyAccessUser, deleteEarlyAccessUser, type EarlyAccessUser } from './actions'

const inputClass =
  'w-full border border-[#E2E0DB] bg-white px-4 py-2.5 text-[12px] tracking-[0.045em] text-[#4A4E57] focus:outline-none focus:border-[#0A0A0A] transition-colors'

function randomPassword(): string {
  // Readable-ish 12-char password (avoids ambiguous chars).
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  let out = ''
  const arr = new Uint32Array(12)
  crypto.getRandomValues(arr)
  for (let i = 0; i < 12; i++) out += chars[arr[i] % chars.length]
  return out
}

export default function EarlyAccessManager({
  initialUsers,
  inviteCode,
}: {
  initialUsers: EarlyAccessUser[]
  inviteCode: string
}) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // Build the shareable sign-up link against the LIVE domain (not whatever
  // origin you happen to be viewing the admin on — e.g. localhost), so the
  // link is always safe to send to people. Override with NEXT_PUBLIC_SITE_URL.
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.myraassistant.co.uk').replace(/\/+$/, '')
  const signupLink = `${siteUrl}/earlyaccess/join?key=${encodeURIComponent(inviteCode)}`
  const [linkCopied, setLinkCopied] = useState(false)

  async function copyLink() {
    if (!signupLink) return
    try {
      await navigator.clipboard.writeText(signupLink)
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 2500)
    } catch { /* ignore */ }
  }

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
      {/* Shareable self-sign-up link */}
      <div className="border border-[#E2E0DB] bg-white rounded-[3px] p-6 mb-8 max-w-[560px]">
        <p className="text-[10px] tracking-[0.113em] text-[#6B6B6B] mb-2">SHAREABLE SIGN-UP LINK</p>
        <p className="text-[10px] tracking-[0.054em] text-[#6B6B6B] leading-relaxed mb-4">
          Send this link to anyone you want to give early access. They open it, enter their own email and
          choose a password, and they&rsquo;re straight into The Edit — no need for you to create a login.
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            readOnly
            value={signupLink}
            onFocus={(e) => e.currentTarget.select()}
            className={`${inputClass} text-[#6B6B6B]`}
          />
          <button
            type="button"
            onClick={copyLink}
            className="shrink-0 bg-[#0A0A0A] text-white px-5 text-[10px] tracking-[0.081em] hover:bg-[#333] transition-colors"
          >
            {linkCopied ? '✓ COPIED' : 'COPY LINK'}
          </button>
        </div>
      </div>

      {/* Create form */}
      <div className="border border-[#E2E0DB] bg-white rounded-[3px] p-6 mb-8 max-w-[560px]">
        <p className="text-[10px] tracking-[0.113em] text-[#6B6B6B] mb-4">OR CREATE A LOGIN MANUALLY</p>
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
              className="shrink-0 border border-[#E2E0DB] text-[#6B6B6B] px-4 text-[10px] tracking-[0.081em] hover:border-[#0A0A0A] hover:text-[#4A4E57] transition-colors"
            >
              GENERATE
            </button>
          </div>
          {error && <p className="text-[10px] tracking-[0.068em] text-[#B83A3A]">{error.toUpperCase()}</p>}
          <button
            type="submit"
            disabled={busy}
            className="bg-[#0A0A0A] text-white px-6 py-2.5 text-[10px] tracking-[0.09em] hover:bg-[#333] transition-colors duration-300 disabled:opacity-40"
          >
            {busy ? 'CREATING…' : 'CREATE LOGIN →'}
          </button>
        </form>

        {created && (
          <div className="mt-5 border border-green-300 bg-green-50 p-4 rounded-[3px]">
            <p className="text-[10px] tracking-[0.081em] text-green-800 mb-2">✓ LOGIN CREATED — SHARE THESE DETAILS</p>
            <p className="text-[11px] tracking-[0.045em] text-[#4A4E57]">myraassistant.co.uk/earlyaccess</p>
            <p className="text-[11px] tracking-[0.045em] text-[#4A4E57] mt-1">Email: {created.email}</p>
            <p className="text-[11px] tracking-[0.045em] text-[#4A4E57]">Password: {created.password}</p>
            <p className="text-[9px] tracking-[0.054em] text-[#6B6B6B] mt-2">
              The password is only shown here — copy it now (it can&rsquo;t be retrieved later, only reset).
            </p>
            <button
              type="button"
              onClick={copyCreds}
              className="mt-3 border border-[#0A0A0A] text-[#4A4E57] px-4 py-2 text-[10px] tracking-[0.081em] hover:bg-[#0A0A0A] hover:text-white transition-colors"
            >
              {copied ? '✓ COPIED' : 'COPY DETAILS'}
            </button>
          </div>
        )}
      </div>

      {/* Existing users */}
      <p className="text-[10px] tracking-[0.113em] text-[#6B6B6B] mb-4">
        {initialUsers.length} EARLY-ACCESS {initialUsers.length === 1 ? 'PERSON' : 'PEOPLE'}
      </p>
      {initialUsers.length === 0 ? (
        <p className="text-[10px] tracking-[0.068em] text-[#A8A8A4]">NO LOGINS YET.</p>
      ) : (
        <div className="border border-[#E2E0DB] rounded-[3px] overflow-hidden">
          {initialUsers.map((u, i) => (
            <div
              key={u.id}
              className={`flex items-center justify-between gap-4 px-5 py-3 bg-white ${i > 0 ? 'border-t border-[#E2E0DB]' : ''}`}
            >
              <div className="min-w-0">
                <p className="text-[12px] tracking-[0.036em] text-[#4A4E57] truncate">{u.email}</p>
                <p className="text-[9px] tracking-[0.068em] text-[#A8A8A4] mt-0.5">
                  ADDED {new Date(u.created_at).toLocaleDateString('en-GB')}
                  {' · '}
                  {u.last_sign_in_at
                    ? `LAST IN ${new Date(u.last_sign_in_at).toLocaleDateString('en-GB')}`
                    : 'NEVER SIGNED IN'}
                </p>
                <p className="text-[9px] tracking-[0.068em] text-[#6B6B6B] mt-1">
                  <span className="text-[#4A4E57]">{u.login_count}</span> LOGIN{u.login_count === 1 ? '' : 'S'}
                  {' · '}
                  <span className="text-[#4A4E57]">{u.visit_count}</span> VISIT{u.visit_count === 1 ? '' : 'S'}
                  {u.last_seen_at && (
                    <> {' · '} LAST SEEN {new Date(u.last_seen_at).toLocaleDateString('en-GB')}</>
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleDelete(u.id)}
                disabled={deletingId === u.id}
                className="shrink-0 text-[9px] tracking-[0.081em] text-[#A8A8A4] hover:text-[#B83A3A] border border-[#E2E0DB] hover:border-[#B83A3A] px-3 py-1.5 transition-colors disabled:opacity-40"
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
