import { redirect } from 'next/navigation'
import { loadMyWardrobe } from './actions'
import WardrobeSelfServe from './WardrobeSelfServe'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export default async function MyWardrobePage() {
  const data = await loadMyWardrobe()
  if ('error' in data) {
    if (data.error === 'Not signed in') redirect('/signin')
    return (
      <div className="space-y-4">
        <p className="text-[15px] tracking-[0.12em] text-[#A8A8A4]">YOUR WARDROBE</p>
        <p className="text-[17px] text-[#B83A3A] leading-relaxed">{data.error}</p>
      </div>
    )
  }
  return <WardrobeSelfServe data={data} />
}
