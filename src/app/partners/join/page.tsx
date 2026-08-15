import { acceptInvite, inviteMeta } from './actions'

export const dynamic = 'force-dynamic'

export default async function PartnerJoinPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string; confirm?: string; mode?: string }>
}) {
  const { token, error, confirm, mode } = await searchParams
  const meta = token ? await inviteMeta(token) : null

  return (
    <div className="min-h-screen bg-[#FAFAF8] flex items-center justify-center px-6">
      <div className="w-full max-w-[400px]">
        <p className="text-[12px] tracking-[0.16em] text-center mb-8">MYRA PARTNERS</p>

        {confirm ? (
          <p className="text-[11px] tracking-[0.05em] text-[#4A4E57] text-center leading-relaxed">
            Check your inbox to confirm your email, then open your invite link again to finish setup.
          </p>
        ) : !meta ? (
          <p className="text-[11px] tracking-[0.05em] text-[#B83A3A] text-center leading-relaxed">
            This invite link is invalid or has expired.<br />Ask MYRA to send a fresh one.
          </p>
        ) : (
          <>
            <p className="text-[11px] tracking-[0.05em] text-[#4A4E57] text-center mb-6 leading-relaxed">
              You&rsquo;ve been invited to the <span className="text-[#0A0A0A]">{meta.merchantName.toUpperCase()}</span> partner
              dashboard as <span className="text-[#0A0A0A]">{meta.email}</span>.
              <br />{mode === 'signin' ? 'Sign in to accept.' : 'Choose a password to create your account.'}
            </p>
            {error && error !== 'invalid' && <p className="text-[10px] tracking-[0.05em] text-[#B83A3A] mb-4 text-center">{error}</p>}
            <form action={acceptInvite} className="space-y-3">
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="mode" value={mode === 'signin' ? 'signin' : 'signup'} />
              <input value={meta.email} disabled className="w-full border border-[#E2E0DB] rounded-[10px] px-4 py-3 text-[12px] bg-[#F5F5F3] text-[#A8A8A4]" />
              <input name="password" type="password" required minLength={8} placeholder={mode === 'signin' ? 'PASSWORD' : 'CHOOSE A PASSWORD (MIN 8 CHARS)'}
                className="w-full border border-[#E2E0DB] rounded-[10px] px-4 py-3 text-[12px] tracking-[0.05em] bg-white focus:outline-none focus:border-[#0A0A0A]" />
              <button className="w-full bg-[#0A0A0A] text-white py-3 text-[11px] tracking-[0.14em] rounded-[10px] hover:opacity-85 transition-opacity">
                {mode === 'signin' ? 'SIGN IN & ACCEPT' : 'CREATE ACCOUNT & ACCEPT'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
