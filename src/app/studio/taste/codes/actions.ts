'use server'

// BRAND CODES — authored identity dimensions. This UI is the ONLY writer of
// brand_codes: no recompute may ever overwrite an authored value. Every edit
// lands in brand_code_event (full history).

import { createAdminClient, createServerClient } from '@/lib/supabase-server'
import { codesComplete, ghostCodes, loadBrandGraph } from '@/lib/brand-affinity'
import { revalidatePath } from 'next/cache'

const PATH = '/studio/taste/codes'

async function requireAdmin(): Promise<void> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.id !== process.env.ADMIN_USER_ID) throw new Error('Not authorised')
}

export interface CodeDimension {
  dimension_key: string
  label: string
  sort: number
  anchors: Record<string, string>
}

export interface CodesBrand {
  brand_id: string
  name: string
  status: string
  complete: boolean
  itemCount: number
  codes: Record<string, number>
  ghosts: Record<string, number> // item-centroid mapped onto mappable dims
}

export interface CodesData {
  dims: CodeDimension[]
  brands: CodesBrand[]
  migrationNeeded?: boolean
  error?: string
}

export async function loadCodesData(): Promise<CodesData> {
  await requireAdmin()
  const admin = createAdminClient() as any
  const { data: dims, error: derr } = await admin
    .from('brand_code_dimension').select('*').order('sort')
  if (derr) return { dims: [], brands: [], migrationNeeded: true, error: derr.message }

  const graph = await loadBrandGraph(admin)
  const brands: CodesBrand[] = graph.brands
    .map((b) => ({
      brand_id: b.brand_id,
      name: b.name,
      status: b.status,
      complete: codesComplete(b),
      itemCount: b.vector_item_count,
      codes: b.codes ?? {},
      ghosts: ghostCodes(b, graph.config.bandBounds),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return { dims: dims ?? [], brands }
}

export async function setBrandCode(brandId: string, dimensionKey: string, value: number): Promise<{ error?: string }> {
  await requireAdmin()
  const admin = createAdminClient() as any
  const v = Math.round(Math.min(5, Math.max(1, value)) * 10) / 10
  const { data: old } = await admin
    .from('brand_codes').select('value').eq('brand_id', brandId).eq('dimension_key', dimensionKey).maybeSingle()
  const { error } = await admin.from('brand_codes').upsert(
    { brand_id: brandId, dimension_key: dimensionKey, value: v, updated_by: 'chloe', updated_at: new Date().toISOString() },
    { onConflict: 'brand_id,dimension_key' },
  )
  if (error) return { error: error.message }
  await admin.from('brand_code_event').insert({
    brand_id: brandId, dimension_key: dimensionKey,
    old_value: old?.value ?? null, new_value: v, updated_by: 'chloe',
  })
  // codes drive similarity — stale cache would keep serving the old identity
  await admin.from('brand_similarity_cache').delete().gte('computed_at', '1970-01-01')
  revalidatePath(PATH)
  revalidatePath('/studio/taste')
  return {}
}
