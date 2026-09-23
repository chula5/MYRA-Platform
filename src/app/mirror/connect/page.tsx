import Link from 'next/link'
import { resolveClientMember, firstNameOf } from '@/lib/client-member'
import { mintMirrorToken } from '@/lib/mirror/auth'

export const dynamic = 'force-dynamic'

// Hand the MYRA Mirror extension her identity. Signed in → a signed member
// token sits in a meta tag that only the extension's content script reads
// (extension/connect.js); nothing is posted anywhere. Not signed in → the
// early-access door. This page is the ONLY place a mirror token is minted.
export default async function MirrorConnectPage({ searchParams }: { searchParams: { as?: string } }) {
  // ?as=<memberId> is honoured only for the admin (resolveClientMember enforces
  // it) and marks the token with her as the actor: stylist mode.
  const member = await resolveClientMember(searchParams.as || undefined)
  const actor = member?.test ? process.env.ADMIN_USER_ID ?? null : null
  const token = member ? mintMirrorToken(member.memberId, { actor }) : null

  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px', background: '#f6f4ef', color: '#141414' }}>
      {token && <meta name="myra-mirror-token" content={token} />}
      {member && <meta name="myra-mirror-member" content={firstNameOf(member.name)} />}
      <div style={{ width: '100%', maxWidth: 560, textAlign: 'center' }}>
        <p style={{ fontSize: 13, letterSpacing: '0.22em', textTransform: 'uppercase', marginBottom: 28 }}>MYRA · MIRROR</p>
        {member ? (
          <>
            <h1 id="myra-mirror-status" style={{ fontSize: 30, lineHeight: 1.2, fontWeight: 500, margin: '0 0 18px' }}>
              Connecting the extension {member.test ? <>as <strong>{firstNameOf(member.name)}</strong> — you, as her stylist</> : <>for {firstNameOf(member.name)}</>}…
            </h1>
            <p id="myra-mirror-help" style={{ fontSize: 19, lineHeight: 1.5, opacity: 0.8, margin: 0 }}>
              If this line stays for more than a moment, the MYRA Mirror extension isn&apos;t installed or enabled in this browser.
            </p>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: 30, lineHeight: 1.2, fontWeight: 500, margin: '0 0 18px' }}>Sign in to MYRA first</h1>
            <p style={{ fontSize: 19, lineHeight: 1.5, opacity: 0.8, margin: '0 0 28px' }}>
              The mirror needs to know whose taste it is carrying onto other sites. Sign in, then come back to this page.
            </p>
            <Link href="/earlyaccess" style={{ display: 'inline-block', fontSize: 15, letterSpacing: '0.18em', textTransform: 'uppercase', padding: '14px 26px', border: '1px solid #141414', textDecoration: 'none', color: 'inherit' }}>
              Sign in
            </Link>
          </>
        )}
      </div>
    </main>
  )
}
