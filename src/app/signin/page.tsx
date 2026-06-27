import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createServerClient } from '@/lib/supabase-server'
import AuthForm from '@/app/earlyaccess/AuthForm'

export const dynamic = 'force-dynamic'

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; mode?: string }>
}) {
  const { error, mode } = await searchParams

  // Already signed in → straight to the edit.
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) redirect('/edit')

  return (
    <main className="min-h-screen bg-white flex flex-col items-center justify-center px-6">
      <AuthForm initialMode={mode === 'signup' ? 'signup' : 'signin'} error={error} />
      <Link href="/" className="mt-10 text-[9px] tracking-[0.12em] text-[#A8A8A4] hover:text-[#4A4E57] transition-colors">
        ← BACK TO MYRA
      </Link>
    </main>
  )
}
