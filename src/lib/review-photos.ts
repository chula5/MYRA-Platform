// PROJECT PHOTOS — every Higgsfield photo shot from an Outfit Review project, in one place.
//
// A picked look becomes a draft outfit and is shot on Higgsfield (lib/review-projects). Each
// take is kept on the outfit (additional_images); the look keeps the latest as shoot_url. This
// reads them back grouped by project, newest project first, each photo with the pieces in it,
// so Chloe can find a picture for content and see what is in it at a glance.

import 'server-only'
import { createAdminClient } from '@/lib/supabase-server'

export interface PhotoPiece {
  item_id: string
  image_url: string
  name: string
  brand: string | null
  price: string
  slot: string
}

export interface ProjectPhoto {
  key: string
  url: string
  lookId: string
  /** MYRA's render check refused this look's takes; shown for her own judgement. */
  refused: boolean
  pieces: PhotoPiece[]
  draftHref: string | null
}

export interface ProjectPhotoGroup {
  projectId: string
  title: string
  kind: string
  photos: ProjectPhoto[]
}

/** Higgsfield takes are kept under the higgsfield-shoots folder on Cloudinary. */
const isShoot = (u: unknown): u is string => typeof u === 'string' && /\/higgsfield-shoots\//.test(u)
/** Titles taken from a shop can carry markup ("<b>DREAM</b>"). */
const plain = (s: string) => s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()

function piece(p: any, slot: string): PhotoPiece | null {
  if (!p?.image_url) return null
  return { item_id: String(p.item_id ?? ''), image_url: String(p.image_url), name: plain(String(p.product_name ?? '')), brand: p.brand_name ?? null, price: String(p.price ?? ''), slot }
}

export async function listProjectPhotos(): Promise<{ groups: ProjectPhotoGroup[]; total: number; error?: string }> {
  const admin = createAdminClient() as any
  const { data: looks, error } = await admin.from('review_project_look')
    .select('look_id, project_id, anchor, items, shoot_url, shoot_status, outfit_id, picked_at')
    .eq('decision', 'picked').not('outfit_id', 'is', null)
    .order('picked_at', { ascending: false })
    .limit(2000)
  if (error) return { groups: [], total: 0, error: error.message }
  const rows = (looks ?? []) as any[]
  if (!rows.length) return { groups: [], total: 0 }

  const projectIds = Array.from(new Set(rows.map((r) => r.project_id)))
  const outfitIds = Array.from(new Set(rows.map((r) => String(r.outfit_id))))
  const [{ data: projects }, outfits] = await Promise.all([
    admin.from('review_project').select('project_id, title, kind, admin_project_id').in('project_id', projectIds),
    (async () => {
      const out: any[] = []
      for (let i = 0; i < outfitIds.length; i += 200) {
        const { data } = await admin.from('outfit').select('outfit_id, image_url, additional_images').in('outfit_id', outfitIds.slice(i, i + 200))
        out.push(...((data ?? []) as any[]))
      }
      return out
    })(),
  ])
  const projectById = new Map(((projects ?? []) as any[]).map((p) => [p.project_id, p]))
  const outfitById = new Map(outfits.map((o) => [String(o.outfit_id), o]))

  const groups = new Map<string, ProjectPhotoGroup>()
  let total = 0
  for (const r of rows) {
    const project = projectById.get(r.project_id)
    if (!project) continue
    const outfit = outfitById.get(String(r.outfit_id))
    // Every take of this look: the one on the look first, then the others kept on the outfit.
    const takes: string[] = []
    for (const u of [r.shoot_url, outfit?.image_url, ...(Array.isArray(outfit?.additional_images) ? outfit.additional_images : [])]) {
      if (isShoot(u) && !takes.includes(u)) takes.push(u)
    }
    if (!takes.length) continue
    const pieces = [piece(r.anchor, 'anchor'), ...(Array.isArray(r.items) ? r.items : []).map((it: any) => piece(it, String(it?.slot ?? '')))]
      .filter((p): p is PhotoPiece => !!p)
    const draftHref = project.admin_project_id ? `/admin/projects/${project.admin_project_id}/outfits/${r.outfit_id}/edit` : null
    let g = groups.get(r.project_id)
    if (!g) { g = { projectId: r.project_id, title: plain(String(project.title ?? 'Untitled')), kind: String(project.kind ?? 'looks'), photos: [] }; groups.set(r.project_id, g) }
    for (const url of takes) {
      g.photos.push({ key: `${r.look_id}:${url}`, url, lookId: r.look_id, refused: r.shoot_status === 'failed', pieces, draftHref })
      total++
    }
  }
  return { groups: Array.from(groups.values()), total }
}
