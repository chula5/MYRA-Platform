import BlackFriday from '../BlackFriday'

export const dynamic = 'force-dynamic'

// THE SALE — where the price tag in the corner goes: her brands' sales, in her
// size, what fills a gap in her wardrobe first. The same section For You shows,
// with room to see all of it.
export default function SalePage() {
  return (
    <div className="w-full pt-2 pb-16">
      <BlackFriday standalone />
    </div>
  )
}
