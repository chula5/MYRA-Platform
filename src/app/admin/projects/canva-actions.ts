'use server'

import { createAdminClient } from '@/lib/supabase-server'
import {
  CANVA_BRAND_TEMPLATE_ID,
  isConnected,
  uploadAssetFromUrl,
  startAutofill,
  getAutofillJob,
} from '@/lib/canva'

/**
 * Kick off a Canva autofill job for an outfit. Returns immediately with a
 * `job_id` that the UI polls via /api/canva/job-status.
 *
 * Data fields currently sent to the template (match these in your Brand Template):
 *   outfit_title, occasion_tags, celebrity_name, model_image,
 *   product_1_image … product_N_image,
 *   product_1_name  … product_N_name,
 *   product_1_brand … product_N_brand,
 *   product_1_price … product_N_price
 */
export async function generateCanvaDeck(
  outfitId: string
): Promise<{ job_id?: string; error?: string }> {
  const connected = await isConnected()
  if (!connected) {
    return { error: 'Canva not connected. Visit /admin/canva to authorise.' }
  }

  if (!CANVA_BRAND_TEMPLATE_ID) {
    return { error: 'CANVA_BRAND_TEMPLATE_ID not set.' }
  }

  const supabase = createAdminClient()

  // 1. Fetch outfit + items
  const { data: outfit, error: outfitErr } = await supabase
    .from('outfit')
    .select(
      `outfit_id, image_url, aesthetic_label, occasion_tags,
       outfit_item(sort_order, slot, item(product_name, image_url, price, currency, brand:brand_id(name)))`
    )
    .eq('outfit_id', outfitId)
    .single()

  if (outfitErr || !outfit) {
    return { error: outfitErr?.message ?? 'Outfit not found' }
  }

  const o = outfit as any

  // 2. Create the job row (status: pending)
  const { data: job, error: insertErr } = await supabase
    .from('canva_job' as any)
    .insert({
      outfit_id: outfitId,
      status: 'pending',
    })
    .select('job_id')
    .single()

  if (insertErr || !job) {
    return { error: insertErr?.message ?? 'Failed to create job row' }
  }

  const jobId = (job as any).job_id as string

  // 3. Kick off the work in the background — don't await
  ;(async () => {
    const admin = createAdminClient()
    const markStatus = async (patch: Record<string, unknown>) =>
      admin
        .from('canva_job' as any)
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('job_id', jobId)

    try {
      await markStatus({ status: 'running' })

      // 3a. Upload model image as a Canva asset
      const modelAssetId = o.image_url
        ? await uploadAssetFromUrl(o.image_url, `model-${outfitId}`)
        : null

      // 3b. Upload each product image as a Canva asset
      const items = ((o.outfit_item as any[]) ?? [])
        .filter((oi) => oi.item)
        .sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999))

      const productAssets: (string | null)[] = []
      for (const oi of items) {
        if (oi.item?.image_url) {
          try {
            const id = await uploadAssetFromUrl(
              oi.item.image_url,
              `item-${outfitId}-${productAssets.length + 1}`
            )
            productAssets.push(id)
          } catch {
            productAssets.push(null)
          }
        } else {
          productAssets.push(null)
        }
      }

      // 3c. Build the autofill data object
      const data: Record<
        string,
        { type: 'text'; text: string } | { type: 'image'; asset_id: string }
      > = {
        outfit_title: { type: 'text', text: (o.aesthetic_label ?? 'Untitled').toString() },
        occasion_tags: { type: 'text', text: (o.occasion_tags ?? []).join(' · ') },
        celebrity_name: { type: 'text', text: (o.celebrity_name ?? '').toString() },
      }

      if (modelAssetId) {
        data.model_image = { type: 'image', asset_id: modelAssetId }
      }

      items.forEach((oi, idx) => {
        const n = idx + 1
        const it = oi.item
        const br = it?.brand
        if (productAssets[idx]) {
          data[`product_${n}_image`] = { type: 'image', asset_id: productAssets[idx]! }
        }
        data[`product_${n}_name`] = {
          type: 'text',
          text: (it?.product_name ?? '').toString(),
        }
        data[`product_${n}_brand`] = {
          type: 'text',
          text: (br?.name ?? '').toString(),
        }
        const priceText = it?.price
          ? `${it.currency ?? ''} ${it.price}`.trim()
          : ''
        data[`product_${n}_price`] = { type: 'text', text: priceText }
      })

      // 3d. Start the autofill job on Canva
      const title =
        `${o.aesthetic_label ?? 'Outfit'}${o.celebrity_name ? ' — ' + o.celebrity_name : ''}`.slice(0, 200)
      const canvaJobId = await startAutofill(CANVA_BRAND_TEMPLATE_ID, title, data)
      await markStatus({ canva_job_id: canvaJobId })

      // 3e. Poll until done (max ~2 min)
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 3000))
        const res = await getAutofillJob(canvaJobId)
        if (res.job.status === 'success') {
          await markStatus({
            status: 'complete',
            design_id: res.job.result.design.id,
            edit_url: res.job.result.design.urls.edit_url,
            preview_url: res.job.result.design.thumbnail?.url ?? null,
          })
          return
        }
        if (res.job.status === 'failed') {
          await markStatus({
            status: 'failed',
            error: res.job.error?.message ?? 'Autofill failed',
          })
          return
        }
      }

      await markStatus({ status: 'failed', error: 'Timed out after 2 minutes' })
    } catch (err: unknown) {
      await markStatus({
        status: 'failed',
        error: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  })()

  return { job_id: jobId }
}
