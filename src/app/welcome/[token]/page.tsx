import Link from 'next/link'
import { createAdminClient, createServerClient } from '@/lib/supabase-server'
import { readInvite } from '@/lib/member-invite'
import { acceptInvite } from './actions'

export const dynamic = 'force-dynamic'

// Her front door, the first time. The link Chloe sent names her member record;
// here she chooses her own email and password.
export default async function WelcomePage({ params, searchParams }: { params: { token: string }; searchParams: { error?: string; as?: string } }) {
  // PREVIEW: /welcome/preview?as=<memberId>, for the admin only — the same page, with nothing to submit.
  let preview: { memberId: string } | null = null
  if (params.token === 'preview' && searchParams.as) {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (user && user.id === process.env.ADMIN_USER_ID) preview = { memberId: searchParams.as }
  }
  const invite = preview ? { memberId: preview.memberId, exp: 0 } : readInvite(params.token)
  let name: string | null = null
  let hasLogin = false
  if (invite) {
    const admin = createAdminClient() as any
    const { data } = await admin.from('pilot_member').select('name, auth_user_id').eq('member_id', invite.memberId).maybeSingle()
    name = data?.name ?? null
    hasLogin = preview ? false : !!data?.auth_user_id
  }
  const first = (name ?? '').trim().split(/\s+/)[0] || null
  const field = 'myra-silver-input text-[clamp(22px,1.5vw,40px)] !py-[clamp(18px,1.3vw,34px)] !px-[clamp(24px,1.8vw,44px)] !rounded-[clamp(20px,1.4vw,36px)]'

  return (
    <main className="min-h-screen myra-pearl flex items-center justify-center px-6 py-14">
      {preview && (
        <p className="fixed top-0 inset-x-0 z-10 text-center text-[15px] tracking-[0.12em] bg-[#8B5E00] text-white py-2.5">
          PREVIEW — THIS IS WHAT {(name ?? 'SHE').toUpperCase()} SEES FROM HER INVITE LINK · STEP 1 OF 3 · NOTHING IS CREATED
        </p>
      )}
      <div className="myra-silver-card w-full max-w-[clamp(600px,42vw,1100px)] text-center px-[clamp(32px,3.5vw,90px)] py-[clamp(40px,3.5vw,90px)]">
        <img src="/myra-logo-black.png" alt="MYRA" className="mx-auto h-[clamp(110px,9vw,230px)] w-auto" />
        {!invite || !name ? (
          <>
            <h1 className="mt-8 text-[34px] leading-tight text-[#2B2B2B]">This link has expired</h1>
            <p className="mt-4 text-[22px] text-[#4A4E57]">Ask Chloe to send you a new one.</p>
          </>
        ) : hasLogin ? (
          <>
            <h1 className="mt-8 text-[34px] leading-tight text-[#2B2B2B]">You already have a login{first ? `, ${first}` : ''}</h1>
            <Link href="/signin" className="inline-block mt-8 text-[22px] px-9 py-4 bg-[#2B2B2B] text-white rounded-full">Sign in</Link>
          </>
        ) : (
          <>
            <h1 className="myra-silver-heading mt-6 text-[clamp(40px,3.3vw,84px)] leading-[1.05] whitespace-nowrap">Welcome{first ? `, ${first}` : ''}</h1>
            <p className="mt-4 text-[clamp(22px,1.6vw,42px)] leading-snug text-[#4A4E57]">
              Your own corner of MYRA is ready. Make a login to keep it yours.
            </p>
            {searchParams.error && <p className="mt-6 text-[clamp(20px,1.3vw,34px)] text-[#B83A3A]">{searchParams.error}</p>}
            <form action={preview ? undefined : acceptInvite} className="mt-[clamp(32px,2.6vw,64px)] space-y-[clamp(20px,1.4vw,34px)] text-left">
              <input type="hidden" name="token" value={decodeURIComponent(params.token)} />
              <input name="email" type="email" required autoComplete="email" placeholder="Your email" className={field} />
              <input name="password" type="password" required minLength={8} autoComplete="new-password" placeholder="Choose a password (8+ characters)" className={field} />
              <input name="confirm" type="password" required minLength={8} autoComplete="new-password" placeholder="Type it once more" className={field} />
              {preview ? (
                <Link href={`/me/welcome?preview=1&as=${preview.memberId}`} className="myra-silver-button !mt-[clamp(32px,2.4vw,60px)] text-[clamp(22px,1.6vw,42px)] tracking-[0.12em] !py-[clamp(18px,1.5vw,40px)] !rounded-[clamp(20px,1.4vw,36px)]">CREATE MY LOGIN →</Link>
              ) : (
                <button type="submit" className="myra-silver-button !mt-[clamp(32px,2.4vw,60px)] text-[clamp(22px,1.6vw,42px)] tracking-[0.12em] !py-[clamp(18px,1.5vw,40px)] !rounded-[clamp(20px,1.4vw,36px)]">CREATE MY LOGIN →</button>
              )}
            </form>
            <p className="mt-2 text-[clamp(20px,1.3vw,34px)] text-[#8A8F95]">Next: connect your accounts, then a quick look around.</p>
          </>
        )}
      </div>
    </main>
  )
}
