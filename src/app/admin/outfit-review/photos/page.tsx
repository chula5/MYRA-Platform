import Link from 'next/link'
import { listProjectPhotos } from '@/lib/review-photos'
import PhotosClient from './PhotosClient'

export const dynamic = 'force-dynamic'

// PROJECT PHOTOS — every photo shot from an Outfit Review project, by project.
export default async function ProjectPhotosPage() {
  const { groups, total, error } = await listProjectPhotos()
  return (
    <div>
      <div className="mb-6">
        <Link href="/admin/outfit-review" className="text-[10px] tracking-[0.18em] text-[#A8A8A4] hover:text-[#0A0A0A]">← OUTFIT REVIEW</Link>
        <h1 className="mt-2 text-[22px] tracking-[0.045em] text-[#4A4E57]">PROJECT PHOTOS</h1>
        <p className="mt-2 text-[12px] tracking-[0.06em] text-[#6B6B6B]">
          {total} PHOTO{total === 1 ? '' : 'S'} FROM {groups.length} PROJECT{groups.length === 1 ? '' : 'S'} · TAP A PHOTO TO SEE IT LARGE, WITH ITS PIECES
        </p>
        {error && <p className="mt-3 text-[11px] tracking-[0.12em] text-[#B83A3A]">{error.toUpperCase()}</p>}
      </div>
      <PhotosClient groups={groups} />
    </div>
  )
}
