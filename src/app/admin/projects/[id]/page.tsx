import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getProject, getProjectOutfits } from '@/lib/admin-queries'
import { createAdminClient } from '@/lib/supabase-server'
import StatusBadge from '@/components/admin/StatusBadge'
import { updateProjectStatus, publishProject } from '@/app/admin/projects/actions'
import EditableProjectTitle from './EditableProjectTitle'
import ProjectOutfitsGrid from './ProjectOutfitsGrid'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function ProjectPage({ params }: PageProps) {
  const { id } = await params
  const [project, outfits] = await Promise.all([getProject(id), getProjectOutfits(id)])

  // Catalogue tag vocabulary + co-occurrence — powers quick-add + autocomplete.
  // popularTags = most-used tags overall; coTags[tag] = tags that most often
  // appear ALONGSIDE it, so suggestions get context-aware (e.g. an outfit tagged
  // "summer" suggests "garden party" / "boat day").
  let popularTags: string[] = []
  let coTags: Record<string, string[]> = {}
  try {
    const admin = createAdminClient()
    const { data: tagRows } = await admin.from('outfit' as any).select('occasion_tags').limit(20000)
    const freq = new Map<string, number>()
    const cooc = new Map<string, Map<string, number>>()
    for (const r of (tagRows ?? []) as { occasion_tags: string[] | null }[]) {
      const tags = Array.from(new Set((r.occasion_tags ?? []).map((t) => String(t).trim().toLowerCase()).filter(Boolean)))
      for (const a of tags) {
        freq.set(a, (freq.get(a) ?? 0) + 1)
        for (const b of tags) {
          if (a === b) continue
          if (!cooc.has(a)) cooc.set(a, new Map())
          const m = cooc.get(a)!
          m.set(b, (m.get(b) ?? 0) + 1)
        }
      }
    }
    popularTags = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t).slice(0, 40)
    for (const [a, m] of cooc) coTags[a] = [...m.entries()].sort((x, y) => y[1] - x[1]).map(([t]) => t).slice(0, 10)
  } catch { /* non-fatal */ }

  // Per-item stock holding from the last stock check, keyed by outfit — shown as
  // a compact line under each card (e.g. DRESS (S·M·L) · SHOE (37·39)).
  const stockByOutfit: Record<string, { type: string; sizes: string[]; status: string | null }[]> = {}
  // Anchor item type + colour per outfit (the lead garment) — powers the filters.
  const anchorByOutfit: Record<string, string> = {}
  const colourByOutfit: Record<string, string> = {}
  try {
    const admin = createAdminClient()
    const outfitIds = (outfits as any[]).map((o) => o.outfit_id)
    if (outfitIds.length) {
      const { data: oiRows } = await admin
        .from('outfit_item')
        .select('outfit_id, slot, item(item_type, colour_family, stock_status, stock_sizes)')
        .in('outfit_id', outfitIds)
        .limit(20000)
      const bySlot: Record<string, Record<string, { type: string; colour: string }>> = {} // outfit → slot → {type,colour}
      for (const r of (oiRows ?? []) as any[]) {
        if (!r.item) continue
        ;(stockByOutfit[r.outfit_id] ??= []).push({
          type: (r.item.item_type ?? r.slot ?? '').toString(),
          sizes: (r.item.stock_sizes ?? []) as string[],
          status: r.item.stock_status ?? null,
        })
        ;(bySlot[r.outfit_id] ??= {})[r.slot] = { type: String(r.item.item_type ?? ''), colour: String(r.item.colour_family ?? '') }
      }
      // Anchor = the lead garment: dress > top > bottom > outerwear, else first.
      for (const [oid, slots] of Object.entries(bySlot)) {
        const a = slots['dress'] || slots['top'] || slots['bottom'] || slots['outerwear'] || Object.values(slots)[0]
        if (a?.type) anchorByOutfit[oid] = a.type
        if (a?.colour) colourByOutfit[oid] = a.colour
      }
    }
  } catch { /* non-fatal */ }

  if (!project) {
    notFound()
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <Link
          href="/admin/projects"
          className="text-[10px] tracking-[0.09em] text-[#6B6B6B] hover:text-[#4A4E57] transition-colors duration-300 mb-4 inline-block"
        >
          ← PROJECTS
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[11px] tracking-[0.113em] text-[#6B6B6B] mb-2">
              {outfits.length} OUTFIT{outfits.length !== 1 ? 'S' : ''}
            </p>
            <div className="flex items-center gap-4">
              <EditableProjectTitle projectId={id} title={project.title} />
              <StatusBadge status={project.status} />
            </div>
          </div>

          {/* Status actions */}
          <div className="flex items-center gap-3 mt-2">
            {project.status === 'draft' && (
              <form
                action={async () => {
                  'use server'
                  await updateProjectStatus(id, 'in_review')
                }}
              >
                <button
                  type="submit"
                  className="border border-[#0A0A0A] bg-transparent text-[#4A4E57] px-6 py-2.5 text-[10px] tracking-[0.09em] hover:bg-[#F2F2F0] transition-colors duration-400"
                >
                  MARK IN REVIEW
                </button>
              </form>
            )}

            {project.status === 'in_review' && (
              <>
                <form
                  action={async () => {
                    'use server'
                    await updateProjectStatus(id, 'draft')
                  }}
                >
                  <button
                    type="submit"
                    className="border border-[#E2E0DB] bg-transparent text-[#6B6B6B] px-6 py-2.5 text-[10px] tracking-[0.09em] hover:border-[#0A0A0A] hover:text-[#4A4E57] transition-colors duration-400"
                  >
                    BACK TO DRAFT
                  </button>
                </form>
                <form
                  action={async () => {
                    'use server'
                    await publishProject(id)
                  }}
                >
                  <button
                    type="submit"
                    className="bg-[#0A0A0A] text-white px-8 py-3.5 text-[11px] tracking-[0.09em] hover:bg-[#333] transition-colors duration-400"
                  >
                    PUBLISH PROJECT
                  </button>
                </form>
              </>
            )}

            {project.status === 'live' && (
              <form
                action={async () => {
                  'use server'
                  await updateProjectStatus(id, 'archived')
                }}
              >
                <button
                  type="submit"
                  className="border border-[#E2E0DB] bg-transparent text-[#6B6B6B] px-6 py-2.5 text-[10px] tracking-[0.09em] hover:border-[#0A0A0A] hover:text-[#4A4E57] transition-colors duration-400"
                >
                  ARCHIVE PROJECT
                </button>
              </form>
            )}
          </div>
        </div>

        {project.notes && (
          <p className="mt-4 text-[11px] tracking-[0.054em] text-[#6B6B6B] max-w-2xl leading-relaxed">
            {project.notes}
          </p>
        )}
      </div>

      {/* Outfits grid — with bulk "select outfits → go live" */}
      <ProjectOutfitsGrid projectId={id} outfits={outfits as any} popularTags={popularTags} coTags={coTags} stockByOutfit={stockByOutfit} anchorByOutfit={anchorByOutfit} colourByOutfit={colourByOutfit} />

      {/* Project meta */}
      <div className="mt-12 pt-8 border-t border-[#E2E0DB]">
        <div className="grid grid-cols-3 gap-6 text-[9px] tracking-[0.068em] text-[#A8A8A4]">
          <div>
            <p className="mb-1">CREATED</p>
            <p className="text-[#6B6B6B]">
              {new Date(project.created_at).toLocaleDateString('en-GB', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              }).toUpperCase()}
            </p>
          </div>
          {project.published_at && (
            <div>
              <p className="mb-1">PUBLISHED</p>
              <p className="text-[#6B6B6B]">
                {new Date(project.published_at).toLocaleDateString('en-GB', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                }).toUpperCase()}
              </p>
            </div>
          )}
          {project.cover_image_url && (
            <div>
              <p className="mb-1">COVER IMAGE</p>
              <p className="text-[#6B6B6B] truncate">{project.cover_image_url}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
