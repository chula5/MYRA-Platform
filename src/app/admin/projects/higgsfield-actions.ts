'use server'

import { execFile } from 'child_process'
import { promisify } from 'util'
import { writeFile, mkdtemp, rm } from 'fs/promises'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import { createAdminClient } from '@/lib/supabase-server'
import { getOutfit } from '@/lib/admin-queries'
import {
  HIGGSFIELD_COMBOS,
  buildGenerationPrompt,
  buildReferenceUrls,
  type ShootItem,
} from '@/lib/higgsfield-shoot'

const execFileP = promisify(execFile)

// Cloudinary creds (same account used elsewhere in the app)
const CLOUD_NAME = 'dugby2pow'
const API_KEY = '333725823491761'
const API_SECRET = 'xlmEKzOlLW9rLxNA6rqTQBn3dkk'

const HF_MODEL = 'seedream_v4_5'

/** Upload a remote image URL to Cloudinary by letting Cloudinary fetch it. */
async function uploadRemoteToCloudinary(remoteUrl: string, publicId: string): Promise<string | null> {
  const timestamp = String(Math.floor(Date.now() / 1000))
  // Dedicated folder so generated shoots are grouped, away from product photos.
  const folder = 'higgsfield-shoots'
  const paramsToSign = `folder=${folder}&public_id=${publicId}&timestamp=${timestamp}`
  const signature = crypto.createHash('sha1').update(paramsToSign + API_SECRET).digest('hex')

  const form = new FormData()
  form.append('file', remoteUrl)
  form.append('api_key', API_KEY)
  form.append('timestamp', timestamp)
  form.append('signature', signature)
  form.append('folder', folder)
  form.append('public_id', publicId)

  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
    method: 'POST',
    body: form,
  })
  const data = await res.json()
  return data.secure_url ?? null
}

/** Extract the first JSON array/object from CLI stdout (ignores any progress lines). */
function extractJson(stdout: string): string | null {
  const start = stdout.indexOf('[')
  const end = stdout.lastIndexOf(']')
  if (start !== -1 && end > start) return stdout.slice(start, end + 1)
  const oStart = stdout.indexOf('{')
  const oEnd = stdout.lastIndexOf('}')
  if (oStart !== -1 && oEnd > oStart) return stdout.slice(oStart, oEnd + 1)
  return null
}

/**
 * Generate an editorial shoot image of an outfit on Higgsfield via the locally
 * authenticated Higgsfield CLI (`node_modules/.bin/higgsfield`), then persist the
 * result to Cloudinary and attach it to the outfit's `additional_images`.
 *
 * The CLI is logged in to the user's own Higgsfield account (one-time
 * `higgsfield auth login`) — no API key required. Runs locally; not for serverless prod.
 *
 * @param outfitId       outfit to attach the result to
 * @param prompt         the editorial generation prompt (built client-side from the skill)
 * @param referenceUrls  outfit item photos + pose/lighting reference (hosted URLs)
 */
export async function generateHiggsfieldShoot(
  outfitId: string,
  prompt: string,
  referenceUrls: string[],
): Promise<{ imageUrl?: string; error?: string }> {
  if (!outfitId) return { error: 'No outfit id' }
  if (!prompt?.trim()) return { error: 'No prompt provided' }
  const refs = (referenceUrls ?? []).filter((u) => typeof u === 'string' && u.startsWith('http')).slice(0, 6)
  if (refs.length === 0) return { error: 'No reference images — add item photos to the outfit first' }

  const bin = path.join(process.cwd(), 'node_modules', '.bin', 'higgsfield')

  // 1. Confirm the CLI is authenticated, with a friendly message if not.
  try {
    await execFileP(bin, ['auth', 'token'], { timeout: 15_000 })
  } catch {
    return {
      error: 'Higgsfield CLI is not logged in. In the project folder run:  ./node_modules/.bin/higgsfield auth login',
    }
  }

  // 2. Download each reference image to a temp file (CLI --image takes a path/upload-id, not a URL).
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hf-shoot-'))
  try {
    const imageArgs: string[] = []
    let i = 0
    for (const url of refs) {
      try {
        const r = await fetch(url)
        if (!r.ok) continue
        const ct = r.headers.get('content-type') ?? 'image/jpeg'
        const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : 'jpg'
        const fp = path.join(dir, `ref-${i++}.${ext}`)
        await writeFile(fp, Buffer.from(await r.arrayBuffer()))
        imageArgs.push('--image', fp)
      } catch {
        /* skip a reference that won't download */
      }
    }
    if (imageArgs.length === 0) return { error: 'Could not download any reference images' }

    // 3. Run the generation, blocking until done.
    const args = [
      'generate', 'create', HF_MODEL,
      '--prompt', prompt,
      ...imageArgs,
      '--aspect_ratio', '3:4',
      '--quality', 'high',
      '--wait', '--wait-timeout', '5m',
      '--json',
    ]

    let stdout = ''
    try {
      const res = await execFileP(bin, args, {
        timeout: 6 * 60_000,
        maxBuffer: 20 * 1024 * 1024,
        cwd: process.cwd(),
        env: process.env,
      })
      stdout = res.stdout
    } catch (err: any) {
      const msg = (err?.stderr || err?.stdout || err?.message || '').toString()
      if (/not authenticated/i.test(msg)) {
        return { error: 'Higgsfield CLI is not logged in. Run: ./node_modules/.bin/higgsfield auth login' }
      }
      return { error: `Higgsfield generation failed: ${msg.slice(0, 300)}` }
    }

    const jsonStr = extractJson(stdout)
    if (!jsonStr) return { error: 'Could not parse Higgsfield response' }
    let jobs: any
    try { jobs = JSON.parse(jsonStr) } catch { return { error: 'Higgsfield returned invalid JSON' } }
    const job = Array.isArray(jobs) ? jobs[0] : jobs
    const resultUrl: string | undefined = job?.result_url
    if (!resultUrl) {
      const status = job?.status ?? 'unknown'
      return { error: `No image returned (status: ${status})` }
    }

    // 4. Persist to Cloudinary so it lives in MYRA's asset pipeline (not ephemeral CDN).
    const cloudUrl = await uploadRemoteToCloudinary(resultUrl, `shoot-${outfitId}-${Date.now()}`)
    const finalUrl = cloudUrl ?? resultUrl

    // 5. Attach to the outfit's additional_images (non-destructive).
    try {
      const admin = createAdminClient()
      const { data: cur } = await admin
        .from('outfit')
        .select('additional_images')
        .eq('outfit_id', outfitId)
        .single()
      const imgs: string[] = Array.isArray((cur as any)?.additional_images) ? (cur as any).additional_images : []
      if (!imgs.includes(finalUrl)) imgs.push(finalUrl)
      await (admin.from('outfit') as any).update({ additional_images: imgs }).eq('outfit_id', outfitId)
    } catch {
      /* image still returned to the client even if the attach fails */
    }

    return { imageUrl: finalUrl }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/**
 * Generate a Higgsfield shoot for an existing outfit by id — builds the prompt
 * and reference URLs server-side from the outfit's own items (via the admin
 * client, so all items are visible regardless of status), then delegates to
 * generateHiggsfieldShoot. Used by the composer's auto-trigger on approve.
 *
 * @param poseKey  one of HIGGSFIELD_COMBOS keys; defaults to 'E5' (Refined).
 */
export async function generateHiggsfieldShootForOutfit(
  outfitId: string,
  poseKey = 'E5',
): Promise<{ imageUrl?: string; error?: string }> {
  const outfit = await getOutfit(outfitId)
  if (!outfit) return { error: 'Outfit not found' }

  const combo = HIGGSFIELD_COMBOS[poseKey] ?? HIGGSFIELD_COMBOS.E5

  const items: ShootItem[] = ((outfit.outfit_item ?? []) as any[])
    .filter((oi) => oi.item)
    .sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999))
    .map((oi) => ({
      product_name: oi.item.product_name,
      item_type: oi.item.item_type,
      material_primary: oi.item.material_primary,
      slot: oi.slot,
      image_url: oi.item.image_url,
      brand_name: oi.item.brand?.name ?? null,
    }))

  if (items.filter((i) => i.image_url).length === 0) {
    return { error: 'Outfit has no item photos to reference' }
  }

  const prompt = buildGenerationPrompt(combo, items)
  const refs = buildReferenceUrls(combo, items)
  const res = await generateHiggsfieldShoot(outfitId, prompt, refs)

  // Promote the generated shoot to the outfit's DISPLAY image. It's already saved
  // to Cloudinary (and appended to additional_images) by generateHiggsfieldShoot;
  // here we set it as image_url and move the previous display (the anchor flat-lay)
  // into additional_images so nothing is lost and the shoot URL isn't duplicated.
  if (res.imageUrl) {
    try {
      const admin = createAdminClient()
      const prevDisplay = (outfit as any).image_url as string | null
      const existingExtras = (((outfit as any).additional_images ?? []) as string[]).filter(Boolean)
      const nextExtras = existingExtras.filter((u) => u !== res.imageUrl)
      if (prevDisplay && prevDisplay !== res.imageUrl && !nextExtras.includes(prevDisplay)) {
        nextExtras.push(prevDisplay)
      }
      await (admin.from('outfit') as any)
        .update({ image_url: res.imageUrl, additional_images: nextExtras })
        .eq('outfit_id', outfitId)
    } catch (err) {
      console.error('[generateHiggsfieldShootForOutfit] set display failed', err)
    }
  }

  return res
}
