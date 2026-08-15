import { redirect } from 'next/navigation'
import { getPartnerContext } from '@/lib/partners/auth'
import { partnerSignIn } from './actions'

export const dynamic = 'force-dynamic'

export default async function PartnerLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams
  if (await getPartnerContext()) redirect('/partners')

  return (
    <div className="min-h-screen bg-[#FAFAF8] flex items-center justify-center px-6">
      <div className="w-full max-w-[380px]">
        <p className="text-[12px] tracking-[0.16em] text-center mb-2">MYRA PARTNERS</p>
        <p className="text-[10px] tracking-[0.08em] text-[#A8A8A4] text-center mb-8">Brand performance &amp; statements</p>
        {error && <p className="text-[10px] tracking-[0.05em] text-[#B83A3A] mb-4 text-center">{error}</p>}
        <form action={partnerSignIn} className="space-y-3">
          <input name="email" type="email" required placeholder="EMAIL"
            className="w-full border border-[#E2E0DB] rounded-[10px] px-4 py-3 text-[12px] tracking-[0.05em] bg-white focus:outline-none focus:border-[#0A0A0A]" />
          <input name="password" type="password" required placeholder="PASSWORD"
            className="w-full border border-[#E2E0DB] rounded-[10px] px-4 py-3 text-[12px] tracking-[0.05em] bg-white focus:outline-none focus:border-[#0A0A0A]" />
          <button className="w-full bg-[#0A0A0A] text-white py-3 text-[11px] tracking-[0.14em] rounded-[10px] hover:opacity-85 transition-opacity">
            SIGN IN
          </button>
        </form>
        <p className="text-[9px] tracking-[0.05em] text-[#A8A8A4] text-center mt-6 leading-relaxed">
          Access is by invitation. If MYRA sent you an invite link, open it to set up your account.
          <br />Interested in partnering? <a href="/partners/apply" className="underline underline-offset-2">Apply here</a>.
        </p>
      </div>
    </div>
  )
}
