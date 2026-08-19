import { redirect } from 'next/navigation'
import { createServerClient, createAdminClient } from '@/lib/supabase-server'
import UploadClient from './UploadClient'

export const dynamic = 'force-dynamic'

export default async function InspirationPage() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/signin')

  const admin = createAdminClient() as any
  const { data } = await admin
    .from('inspiration_image')
    .select('image_id, image_url')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(60)

  return <UploadClient existing={(data ?? []) as { image_id: string; image_url: string }[]} />
}
