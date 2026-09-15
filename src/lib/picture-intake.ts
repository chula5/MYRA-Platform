// PICTURE INTAKE — pasted screenshots, chosen files and image links, made into
// one hosted image per outfit.
//
// Shared by a client's reference pictures and a house style's moodboard, so a
// Pinterest board is split the same way wherever it is pasted. A screenshot of
// several outfits is cut into one picture per outfit (lib/outfit-tiles); each
// keeps the hosted screenshot it came from as its source_url.

import { persistImageToCloudinary, uploadImageBytesToCloudinary } from '@/lib/cloudinary-persist'
import { splitIntoOutfits } from '@/lib/outfit-tiles'

export const MAX_PICTURE_BYTES = 9 * 1024 * 1024

export interface IntakeRow {
  image_url: string
  /** The screenshot it was cut from, or the picture itself when it was single. */
  source_url: string
}

export interface IntakeResult {
  rows: IntakeRow[]
  screenshots: number
  failed: number
  notes: string[]
}

/** Read files and links off a form: `files` (File[]) and `urls` (text). */
export async function picturesFromForm(formData: FormData, folder: string): Promise<{ inputs: { data: Buffer; type: string }[]; failed: number }> {
  const inputs: { data: Buffer; type: string }[] = []
  let failed = 0
  const files = formData.getAll('files').filter((f): f is File => f instanceof File && f.size > 0)
  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    if (f.size > MAX_PICTURE_BYTES) { failed++; continue }
    inputs.push({ data: Buffer.from(await f.arrayBuffer()), type: f.type || 'image/png' })
  }
  const links = String(formData.get('urls') ?? '').split(/[\s,]+/).map((u) => u.trim()).filter((u) => /^https?:\/\//i.test(u))
  for (let i = 0; i < links.length; i++) {
    // Re-host first: borrowed links rot and hotlink-block.
    const hosted = await persistImageToCloudinary(links[i], { folder, publicId: stamp() })
    const res = hosted ? await fetch(hosted).catch(() => null) : null
    if (!res?.ok) { failed++; continue }
    inputs.push({ data: Buffer.from(await res.arrayBuffer()), type: res.headers.get('content-type') || 'image/jpeg' })
  }
  return { inputs, failed }
}

function stamp(): string {
  return `pic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** Split every input into its outfits and host each one. */
export async function intakePictures(inputs: { data: Buffer; type: string }[], folder: string): Promise<IntakeResult> {
  const rows: IntakeRow[] = []
  const notes: string[] = []
  let screenshots = 0
  let failed = 0
  for (const input of inputs) {
    const split = await splitIntoOutfits(input.data)
    if (split.crops.length > 1) {
      const sheet = await uploadImageBytesToCloudinary(input.data, input.type, { folder: `${folder}/screenshots`, publicId: stamp() })
      screenshots++
      for (const crop of split.crops) {
        const url = await uploadImageBytesToCloudinary(crop, 'image/jpeg', { folder, publicId: stamp() })
        if (url) rows.push({ image_url: url, source_url: sheet ?? url }); else failed++
      }
      notes.push(`${split.crops.length} outfits found in one screenshot`)
    } else {
      const url = await uploadImageBytesToCloudinary(input.data, input.type, { folder, publicId: stamp() })
      if (url) rows.push({ image_url: url, source_url: url }); else failed++
      if (split.note && split.note !== 'a single photo') notes.push(`kept as one picture — ${split.note}`)
    }
  }
  return { rows, screenshots, failed, notes }
}
