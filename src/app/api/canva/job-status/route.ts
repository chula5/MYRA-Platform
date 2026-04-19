import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const jobId = url.searchParams.get('job_id')
  if (!jobId) {
    return NextResponse.json({ error: 'job_id required' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('canva_job' as any)
    .select('status, edit_url, preview_url, design_id, error, created_at, updated_at')
    .eq('job_id', jobId)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'not found' }, { status: 404 })
  }

  return NextResponse.json({ job: data })
}
