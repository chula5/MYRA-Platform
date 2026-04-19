'use server'

import crypto from 'crypto'
import { createServerClient } from '@/lib/supabase-server'
import { redirect } from 'next/navigation'

const CLOUD_NAME = 'dugby2pow'
const API_KEY = '333725823491761'
const API_SECRET = 'xlmEKzOlLW9rLxNA6rqTQBn3dkk'

function makePublicId(imageUrl: string): string {
  try {
    const url = new URL(imageUrl)
    const parts = url.pathname.split('/').filter(Boolean)
    const filename = parts[parts.length - 1]?.split('.')[0] ?? 'outfit'
    return filename.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 60)
  } catch {
    return `outfit-${Date.now()}`
  }
}

export async function uploadOutfitToCloudinaryAndCreateProject(formData: FormData) {
  const imageUrl = (formData.get('image_url') as string)?.trim()
  const projectTitle = (formData.get('project_title') as string)?.trim() || 'New Outfit Project'
  const celebrityName = (formData.get('celebrity_name') as string)?.trim() || null
  const existingProjectId = (formData.get('project_id') as string)?.trim() || null

  if (!imageUrl) throw new Error('Image URL is required')

  // 1. Upload to Cloudinary
  const timestamp = String(Math.floor(Date.now() / 1000))
  const folder = 'outfit-saves'
  const publicId = makePublicId(imageUrl)

  const paramsToSign = `folder=${folder}&public_id=${publicId}&timestamp=${timestamp}`
  const signature = crypto.createHash('sha1')
    .update(paramsToSign + API_SECRET)
    .digest('hex')

  const formPayload = new FormData()
  formPayload.append('file', imageUrl)
  formPayload.append('api_key', API_KEY)
  formPayload.append('timestamp', timestamp)
  formPayload.append('signature', signature)
  formPayload.append('folder', folder)
  formPayload.append('public_id', publicId)

  const cloudRes = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
    method: 'POST',
    body: formPayload,
  })

  const cloudData = await cloudRes.json()
  if (!cloudData.secure_url) throw new Error(cloudData.error?.message ?? 'Cloudinary upload failed')

  const cloudinaryUrl = cloudData.secure_url as string

  // 2. Create outfit in Supabase
  const supabase = await createServerClient()

  const { data: outfit, error: outfitError } = await supabase
    .from('outfit')
    .insert({
      image_url: cloudinaryUrl,
      aesthetic_label: projectTitle,
      celebrity_name: celebrityName,
      status: 'draft',
      occasion_tags: [],
      formality: 'smart_casual',
      construction: 'tailored',
    })
    .select('outfit_id')
    .single()

  if (outfitError || !outfit) throw new Error(outfitError?.message ?? 'Failed to create outfit')

  let projectId: string

  if (existingProjectId) {
    // 3a. Add outfit to existing project
    const { data: existing, error: fetchError } = await supabase
      .from('admin_project')
      .select('outfit_ids, cover_image_url')
      .eq('project_id', existingProjectId)
      .single()

    if (fetchError || !existing) throw new Error('Could not find selected project')

    const updatedIds = [...(existing.outfit_ids ?? []), outfit.outfit_id]
    const { error: updateError } = await supabase
      .from('admin_project')
      .update({
        outfit_ids: updatedIds,
        // Set cover if project has none yet
        ...(!existing.cover_image_url ? { cover_image_url: cloudinaryUrl } : {}),
      })
      .eq('project_id', existingProjectId)

    if (updateError) throw new Error(updateError.message ?? 'Failed to update project')
    projectId = existingProjectId
  } else {
    // 3b. Create a new project
    const { data: project, error: projectError } = await supabase
      .from('admin_project')
      .insert({
        title: projectTitle,
        status: 'draft',
        cover_image_url: cloudinaryUrl,
        outfit_ids: [outfit.outfit_id],
        notes: null,
      })
      .select('project_id')
      .single()

    if (projectError || !project) throw new Error(projectError?.message ?? 'Failed to create project')
    projectId = project.project_id
  }

  redirect(`/admin/projects/${projectId}`)
}
