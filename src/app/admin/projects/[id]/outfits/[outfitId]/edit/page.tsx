import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getProject, getOutfit, getLookbooks, getOutfitLookbookIds } from '@/lib/admin-queries'
import OutfitBuilder from '@/components/admin/OutfitBuilder'
import {
  createOutfit,
  updateOutfit,
  removeItemFromOutfit,
} from '@/app/admin/projects/actions'

interface PageProps {
  params: Promise<{ id: string; outfitId: string }>
}

export default async function EditOutfitPage({ params }: PageProps) {
  const { id, outfitId } = await params
  const [project, outfit, lookbooks, outfitLookbookIds] = await Promise.all([
    getProject(id),
    getOutfit(outfitId),
    getLookbooks(),
    getOutfitLookbookIds(outfitId),
  ])

  if (!project || !outfit) {
    notFound()
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <Link
          href={`/admin/projects/${id}`}
          className="text-[10px] tracking-[0.20em] text-[#6B6B6B] hover:text-[#0A0A0A] transition-colors duration-300 mb-4 inline-block"
        >
          ← {project.title.toUpperCase()}
        </Link>
        <div>
          <p className="text-[11px] tracking-[0.25em] text-[#6B6B6B] mb-2">EDIT OUTFIT</p>
          <h1 className="text-[28px] tracking-[0.10em] text-[#0A0A0A]">
            {outfit.aesthetic_label.toUpperCase()}
          </h1>
        </div>
      </div>

      <OutfitBuilder
        outfit={outfit}
        projectId={id}
        createAction={createOutfit}
        updateAction={updateOutfit}
        removeItemAction={removeItemFromOutfit}
        lookbooks={lookbooks}
        outfitLookbookIds={outfitLookbookIds}
      />
    </div>
  )
}
