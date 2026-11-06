'use server'

// THE WEEK'S NEW BRANDS — Chloe reads, edits and sends the note here.
// Every export here is public to the browser, so each one starts by proving
// the admin session.

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase-server'
import { assertAdmin } from '@/lib/admin-audit'
import { draftNewBrandsNote, sendNewBrandsNote, type NewBrandsNote, type NoteBrand } from '@/lib/new-brands-note'

const PATH = '/admin/new-brands'

async function load(admin: any, noteId: string): Promise<NewBrandsNote | null> {
  const { data } = await admin.from('new_brands_note').select('*').eq('note_id', noteId).maybeSingle()
  return (data as NewBrandsNote) ?? null
}

/** Draft this week's note now rather than waiting for Saturday night. */
export async function draftNow(): Promise<{ error?: string; empty?: boolean }> {
  await assertAdmin()
  try {
    const { note } = await draftNewBrandsNote(createAdminClient() as any)
    revalidatePath(PATH)
    return note ? {} : { empty: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

export async function saveNote(
  noteId: string,
  edits: { title: string; body: string; email_intro: string; brands: NoteBrand[] },
): Promise<{ error?: string }> {
  await assertAdmin()
  const admin = createAdminClient() as any
  const note = await load(admin, noteId)
  if (!note) return { error: 'Note not found' }
  if (note.status !== 'draft') return { error: 'This note has already gone' }
  const { error } = await admin.from('new_brands_note').update({
    title: edits.title.trim(), body: edits.body.trim(), email_intro: edits.email_intro.trim(),
    brands: edits.brands, updated_at: new Date().toISOString(),
  }).eq('note_id', noteId)
  revalidatePath(PATH)
  return error ? { error: error.message } : {}
}

/** A sample email to Chloe only. Nothing is marked; no member is told. */
export async function sendTest(noteId: string): Promise<{ error?: string; to?: string }> {
  await assertAdmin()
  const admin = createAdminClient() as any
  const note = await load(admin, noteId)
  if (!note) return { error: 'Note not found' }
  const to = process.env.STUDIO_EMAIL_TO ?? 'chloe@myraassistant.co.uk'
  const r = await sendNewBrandsNote(admin, note, { testTo: to })
  return r.error ? { error: String(r.error) } : { to }
}

export async function sendToMembers(noteId: string): Promise<{ error?: string; report?: Record<string, unknown> }> {
  await assertAdmin()
  const admin = createAdminClient() as any
  const before = await load(admin, noteId)
  if (!before?.brands.length) return { error: 'There are no brands left in this note' }
  // Claim the note first, so a double press can never send twice.
  const { data: claimed } = await admin.from('new_brands_note')
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .eq('note_id', noteId).eq('status', 'draft').select('*')
  const note = (claimed ?? [])[0] as NewBrandsNote | undefined
  if (!note) return { error: 'This note has already gone, or was skipped' }
  const report = await sendNewBrandsNote(admin, note)
  await admin.from('new_brands_note').update({ sent_report: report }).eq('note_id', noteId)
  revalidatePath(PATH)
  return report.error ? { error: String(report.error), report } : { report }
}

export async function skipNote(noteId: string): Promise<{ error?: string }> {
  await assertAdmin()
  const { error } = await (createAdminClient() as any).from('new_brands_note')
    .update({ status: 'skipped', updated_at: new Date().toISOString() })
    .eq('note_id', noteId).eq('status', 'draft')
  revalidatePath(PATH)
  return error ? { error: error.message } : {}
}
