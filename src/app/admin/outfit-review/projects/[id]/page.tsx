import Link from 'next/link'
import { getReviewProject } from '@/lib/review-projects'
import ProjectClient from './ProjectClient'

export const dynamic = 'force-dynamic'

export default async function ReviewProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { project, looks, error } = await getReviewProject(id)
  if (!project) {
    return (
      <div>
        <p className="text-[10px] tracking-[0.25em] text-[#6B6B6B] mb-1">ADMIN · OUTFIT REVIEW</p>
        <h1 className="text-[22px] tracking-[0.045em] text-[#4A4E57]">PROJECT</h1>
        <p className="mt-4 text-[10px] tracking-[0.12em] text-[#B83A3A]">{(error ?? 'Project not found').toUpperCase()}</p>
        <Link href="/admin/outfit-review" className="inline-block mt-6 text-[10px] tracking-[0.14em] text-[#6B6B6B] hover:text-[#0A0A0A]">← BACK TO OUTFIT REVIEW</Link>
      </div>
    )
  }
  return <ProjectClient initialProject={project} initialLooks={looks} />
}
