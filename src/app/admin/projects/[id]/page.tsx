import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getProject, getProjectOutfits } from '@/lib/admin-queries'
import StatusBadge from '@/components/admin/StatusBadge'
import { updateProjectStatus, publishProject } from '@/app/admin/projects/actions'
import EditableProjectTitle from './EditableProjectTitle'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function ProjectPage({ params }: PageProps) {
  const { id } = await params
  const [project, outfits] = await Promise.all([getProject(id), getProjectOutfits(id)])

  if (!project) {
    notFound()
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <Link
          href="/admin/projects"
          className="text-[10px] tracking-[0.20em] text-[#6B6B6B] hover:text-[#0A0A0A] transition-colors duration-300 mb-4 inline-block"
        >
          ← PROJECTS
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[11px] tracking-[0.25em] text-[#6B6B6B] mb-2">
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
                  className="border border-[#0A0A0A] bg-transparent text-[#0A0A0A] px-6 py-2.5 text-[10px] tracking-[0.20em] hover:bg-[#F2F2F0] transition-colors duration-400"
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
                    className="border border-[#E2E0DB] bg-transparent text-[#6B6B6B] px-6 py-2.5 text-[10px] tracking-[0.20em] hover:border-[#0A0A0A] hover:text-[#0A0A0A] transition-colors duration-400"
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
                    className="bg-[#0A0A0A] text-white px-8 py-3.5 text-[11px] tracking-[0.20em] hover:bg-[#333] transition-colors duration-400"
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
                  className="border border-[#E2E0DB] bg-transparent text-[#6B6B6B] px-6 py-2.5 text-[10px] tracking-[0.20em] hover:border-[#0A0A0A] hover:text-[#0A0A0A] transition-colors duration-400"
                >
                  ARCHIVE PROJECT
                </button>
              </form>
            )}
          </div>
        </div>

        {project.notes && (
          <p className="mt-4 text-[11px] tracking-[0.12em] text-[#6B6B6B] max-w-2xl leading-relaxed">
            {project.notes}
          </p>
        )}
      </div>

      {/* Outfits grid */}
      <div className="grid grid-cols-3 gap-6">
        {outfits.map((outfit) => (
          <div
            key={outfit.outfit_id}
            className="border border-[#E2E0DB] bg-white rounded-[3px] overflow-hidden group hover:border-[#C4A882] transition-colors duration-400"
          >
            {/* Image */}
            <div
              className="bg-[#F2F2F0] overflow-hidden"
              style={{ aspectRatio: '3/4' }}
            >
              {outfit.image_url ? (
                <img
                  src={outfit.image_url}
                  alt={outfit.aesthetic_label}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <span className="text-[9px] tracking-[0.15em] text-[#A8A8A4]">NO IMAGE</span>
                </div>
              )}
            </div>

            {/* Card body */}
            <div className="p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[11px] tracking-[0.15em] text-[#0A0A0A] truncate">
                  {((outfit as any).celebrity_name || outfit.aesthetic_label).toUpperCase()}
                </p>
                <StatusBadge status={outfit.status} />
              </div>
              <Link
                href={`/admin/projects/${id}/outfits/${outfit.outfit_id}/edit`}
                className="text-[9px] tracking-[0.20em] text-[#6B6B6B] group-hover:text-[#0A0A0A] transition-colors duration-300"
              >
                EDIT →
              </Link>
            </div>
          </div>
        ))}

        {/* Add outfit card */}
        <Link
          href={`/admin/projects/${id}/outfits/new`}
          className="border border-dashed border-[#E2E0DB] bg-transparent rounded-[3px] flex items-center justify-center min-h-[280px] hover:border-[#0A0A0A] transition-colors duration-400 group"
        >
          <div className="text-center">
            <p className="text-[24px] text-[#E2E0DB] group-hover:text-[#A8A8A4] transition-colors duration-300 mb-2">+</p>
            <p className="text-[10px] tracking-[0.20em] text-[#A8A8A4] group-hover:text-[#0A0A0A] transition-colors duration-300">
              ADD OUTFIT
            </p>
          </div>
        </Link>
      </div>

      {/* Project meta */}
      <div className="mt-12 pt-8 border-t border-[#E2E0DB]">
        <div className="grid grid-cols-3 gap-6 text-[9px] tracking-[0.15em] text-[#A8A8A4]">
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
