import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

// The sign-in page now lives at /signin. Keep /earlyaccess working (old links,
// bookmarks) by forwarding to it, preserving any error/mode query.
export default async function EarlyAccessPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; mode?: string }>
}) {
  const { error, mode } = await searchParams
  const qs = new URLSearchParams()
  if (error) qs.set('error', error)
  if (mode) qs.set('mode', mode)
  const q = qs.toString()
  redirect(`/signin${q ? `?${q}` : ''}`)
}
