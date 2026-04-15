import Link from 'next/link'
import { getAllProjects } from '@/lib/admin-queries'
import StatusBadge from '@/components/admin/StatusBadge'

const FILTER_TABS = ['all', 'draft', 'in_review', 'live', 'archived'] as const

interface PageProps {
  searchParams: Promise<{ filter?: string }>
}

export default async function ProjectsPage({ searchParams }: PageProps) {
  const { filter } = await searchParams
  const activeFilter = filter || 'all'
  const projects = await getAllProjects(activeFilter === 'all' ? undefined : activeFilter)

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <p className="text-[11px] tracking-[0.25em] text-[#6B6B6B] mb-2">ADMIN STUDIO</p>
          <h1 className="text-[28px] tracking-[0.10em] text-[#0A0A0A]">OUTFIT PROJECTS</h1>
        </div>
        <Link
          href="/admin/projects/new"
          className="bg-[#0A0A0A] text-white px-8 py-3.5 text-[11px] tracking-[0.20em] transition-colors duration-400 hover:bg-[#333]"
        >
          NEW PROJECT →
        </Link>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-2 mb-8 border-b border-[#E2E0DB] pb-4">
        {FILTER_TABS.map((tab) => (
          <Link
            key={tab}
            href={tab === 'all' ? '/admin/projects' : `/admin/projects?filter=${tab}`}
            className={`px-4 py-2 text-[10px] tracking-[0.20em] transition-all duration-300 rounded-[2px] ${
              activeFilter === tab
                ? 'bg-[#0A0A0A] text-white'
                : 'border border-[#E2E0DB] text-[#6B6B6B] hover:border-[#0A0A0A] hover:text-[#0A0A0A]'
            }`}
          >
            {tab.toUpperCase().replace('_', ' ')}
          </Link>
        ))}
      </div>

      {/* Search for new outfits */}
      <Link
        href="/admin/runway-search"
        className="flex items-center justify-between w-full border border-[#E2E0DB] bg-white px-6 py-5 mb-8 hover:border-[#0A0A0A] transition-colors duration-300 group"
      >
        <div>
          <p className="text-[11px] tracking-[0.25em] text-[#6B6B6B] mb-1">AI POWERED</p>
          <p className="text-[14px] tracking-[0.15em] text-[#0A0A0A]">SEARCH FOR NEW OUTFITS →</p>
          <p className="text-[10px] tracking-[0.12em] text-[#A8A8A4] mt-1">Browse SS26 / AW25 runway looks by brand or trend</p>
        </div>
        <span className="text-[24px] text-[#E2E0DB] group-hover:text-[#0A0A0A] transition-colors duration-300">↗</span>
      </Link>

      {/* Grid */}
      {projects.length === 0 ? (
        <div className="py-20 text-center">
          <p className="text-[11px] tracking-[0.20em] text-[#A8A8A4]">
            NO PROJECTS YET. CREATE YOUR FIRST PROJECT.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-6">
          {projects.map((project) => (
            <div
              key={project.project_id}
              className="border border-[#E2E0DB] bg-white rounded-[3px] overflow-hidden hover:border-[#C4A882] transition-colors duration-400 group"
            >
              {/* Cover image */}
              <div className="aspect-video bg-[#F2F2F0] overflow-hidden">
                {project.cover_image_url ? (
                  <img
                    src={project.cover_image_url}
                    alt={project.title}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <span className="text-[9px] tracking-[0.20em] text-[#A8A8A4]">NO COVER IMAGE</span>
                  </div>
                )}
              </div>

              {/* Card body */}
              <div className="p-6">
                <div className="flex items-start justify-between mb-3">
                  <h2 className="text-[14px] tracking-[0.15em] text-[#0A0A0A]">
                    {project.title.toUpperCase()}
                  </h2>
                  <StatusBadge status={project.status} />
                </div>
                <div className="flex items-center gap-4 mb-6">
                  <p className="text-[9px] tracking-[0.15em] text-[#A8A8A4]">
                    {project.outfit_ids.length} OUTFIT{project.outfit_ids.length !== 1 ? 'S' : ''}
                  </p>
                  <p className="text-[9px] tracking-[0.15em] text-[#A8A8A4]">
                    {new Date(project.created_at).toLocaleDateString('en-GB', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    }).toUpperCase()}
                  </p>
                </div>
                <Link
                  href={`/admin/projects/${project.project_id}`}
                  className="text-[10px] tracking-[0.20em] text-[#6B6B6B] group-hover:text-[#0A0A0A] transition-colors duration-300"
                >
                  OPEN PROJECT →
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
