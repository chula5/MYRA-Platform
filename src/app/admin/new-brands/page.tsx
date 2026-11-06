import { createAdminClient } from '@/lib/supabase-server'
import { noteEmailHtml, type NewBrandsNote } from '@/lib/new-brands-note'
import NewBrandsClient from './NewBrandsClient'

export const dynamic = 'force-dynamic'

// THE WEEK'S NEW BRANDS — drafted Saturday night, read and sent from here.
export default async function NewBrandsPage() {
  const admin = createAdminClient() as any
  const { data, error } = await admin
    .from('new_brands_note')
    .select('*')
    .order('week_of', { ascending: false })
    .limit(12)
  const notes = ((data ?? []) as NewBrandsNote[])
  const notMigrated = !!error && /new_brands_note|schema cache|does not exist/i.test(error.message)
  const previews = Object.fromEntries(notes.map((n) => [n.note_id, noteEmailHtml(n, n.brands, 'Anne')]))
  return <NewBrandsClient notes={notes} previews={previews} notMigrated={notMigrated} />
}
