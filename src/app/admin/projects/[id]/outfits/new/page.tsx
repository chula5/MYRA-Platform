import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getProject } from '@/lib/admin-queries'
import OutfitBuilder from '@/components/admin/OutfitBuilder'
import {
  createOutfit,
  updateOutfit,
  removeItemFromOutfit,
} from '@/app/admin/projects/actions'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function NewOutfitPage({ params }: PageProps) {
  const { id } = await params
  const project = await getProject(id)

  if (!project) {
    notFound()
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <Link
          href={`/admin/projects/${id}`}
          className="text-[10px] tracking-[0.09em] text-[#6B6B6B] hover:text-[#4A4E57] transition-colors duration-300 mb-4 inline-block"
        >
          ← {project.title.toUpperCase()}
        </Link>
        <div>
          <p className="text-[11px] tracking-[0.113em] text-[#6B6B6B] mb-2">NEW OUTFIT</p>
          <h1 className="text-[28px] tracking-[0.045em] text-[#4A4E57]">BUILD OUTFIT</h1>
        </div>
      </div>

      <OutfitBuilder
        projectId={id}
        createAction={createOutfit}
        updateAction={updateOutfit}
        removeItemAction={removeItemFromOutfit}
      />
    </div>
  )
}
