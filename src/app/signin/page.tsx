import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createServerClient } from '@/lib/supabase-server'
import AuthForm from '@/app/earlyaccess/AuthForm'
import { resolveClientMember } from '@/lib/client-member'
import AppDoor from '@/components/AppDoor'
import WebOnly from '@/components/WebOnly'

export const dynamic = 'force-dynamic'

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; mode?: string; next?: string }>
}) {
  const { error, mode, next } = await searchParams

  // Where she was on her way to — the Mirror connect flow, for one. Only a
  // same-origin path is ever honoured, never an off-site address.
  const back = next && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') ? next : null

  // Already signed in → straight to the private member area, or back to
  // wherever she was heading.
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    const isAdmin = user.id === process.env.ADMIN_USER_ID
    if (isAdmin || (await resolveClientMember())) redirect(back ?? '/me')
    redirect('/')
  }

  return (
    <>
      {/* Inside the iPhone app this page is the front door: logo, SIGN IN, APPLY — never the website. */}
      <AppDoor state="out" error={error} />
      {/* The website's page — white ground and form — is invisible in the app
          from the first paint (WebOnly), so the wait is the door's pearl. */}
      <WebOnly>
        <main className="min-h-screen bg-white flex flex-col items-center justify-center px-6">
          <AuthForm initialMode={mode === 'signup' ? 'signup' : 'signin'} error={error} next={back} />
          <Link href="/" className="mt-10 text-[9px] tracking-[0.12em] text-[#A8A8A4] hover:text-[#4A4E57] transition-colors">
            ← BACK TO MYRA
          </Link>
        </main>
      </WebOnly>
    </>
  )
}
