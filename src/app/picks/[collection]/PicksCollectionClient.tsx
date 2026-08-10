'use client'

// A curated picks collection page (e.g. /picks/bags — the destination when the
// OUR PICKS headline bag is clicked). Editorially scattered product moments;
// each piece is shoppable, with the live outfits it appears in as small
// clickable thumbs beneath — "wear it like this".

import { useRouter } from 'next/navigation'
import { openShop } from '@/components/ShopLink'
import { thumbUrl } from '@/lib/image-utils'
import type { PickWithOutfits } from '@/lib/our-picks'

const SCATTER: { wrap: string; img: string }[] = [
  { wrap: '', img: 'aspect-[3/4]' },
  { wrap: 'sm:mt-24', img: 'aspect-square' },
  { wrap: 'sm:mt-8', img: 'aspect-[3/4]' },
  { wrap: 'sm:-mt-12', img: 'aspect-square' },
  { wrap: 'sm:mt-16', img: 'aspect-[3/4]' },
  { wrap: 'sm:mt-4', img: 'aspect-square' },
]

export default function PicksCollectionClient({
  title,
  picks,
}: {
  title: string
  picks: PickWithOutfits[]
}) {
  const router = useRouter()

  return (
    <div className="w-full px-6 sm:px-10 py-14">
      <a
        href="/"
        className="inline-flex items-center gap-2.5 border border-[#0A0A0A] text-[#0A0A0A] px-6 py-3 rounded-full text-[13px] tracking-[0.16em] hover:bg-[#0A0A0A] hover:text-white transition-colors duration-300"
      >
        <span className="text-[16px] leading-none">←</span> BACK TO MYRA
      </a>
      {/* Oversized display headline HANGING OVER the bag images — the grid
          tucks up underneath the letters. */}
      <h1
        className="relative z-10 font-bold leading-[0.88] tracking-[-0.02em] text-[#0A0A0A] uppercase text-center mt-8 pointer-events-none"
        style={{ fontSize: 'clamp(64px, 12vw, 190px)', marginBottom: '-0.42em' }}
      >
        {title}
      </h1>

      {picks.length === 0 ? (
        <p className="text-[11px] tracking-[0.12em] text-[#A8A8A4] py-20 text-center">NOTHING HERE YET — CHECK BACK SOON.</p>
      ) : (
        <div className="relative z-0 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-14 pt-[0.1em]">
          {picks.map((pick, i) => {
            const s = SCATTER[i % SCATTER.length]
            // Outfit cards pinned to the bag's bottom-left corner like a
            // collage — each one rotated a little, overlapping the product
            // image and each other.
            const PIN = [
              { rotate: -7, left: '-3%', bottom: '-7%', z: 3 },
              { rotate: 5, left: '18%', bottom: '-11%', z: 2 },
              { rotate: -3, left: '39%', bottom: '-6%', z: 1 },
            ]
            return (
              <div key={pick.item_id} className={`${s.wrap} mb-14 sm:mb-16`}>
                <div className="relative">
                  {/* The piece itself — click to shop */}
                  <button
                    onClick={() => pick.retailer_url && openShop({ item_id: pick.item_id, retailer_url: pick.retailer_url, product_name: pick.product_name, brand: { name: pick.brand_name ?? '' } } as any)}
                    className="group block w-full text-left"
                  >
                    <div className={`${s.img} bg-[#EDEDEB] overflow-hidden`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={thumbUrl(pick.image_url, 900)}
                        alt={pick.product_name}
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                      />
                    </div>
                  </button>

                  {/* WEAR IT LIKE THIS — collaged outfit cards over the corner */}
                  {pick.outfits.slice(0, 3).map((o, oi) => {
                    const p = PIN[oi % PIN.length]
                    return (
                      <button
                        key={o.outfit_id}
                        onClick={() => router.push(`/outfit/${o.outfit_id}`)}
                        aria-label="See this bag styled"
                        className="absolute group/thumb transition-transform duration-300 hover:-translate-y-1.5 hover:z-10"
                        style={{
                          left: p.left,
                          bottom: p.bottom,
                          width: 'clamp(84px, 9vw, 148px)',
                          transform: `rotate(${p.rotate}deg)`,
                          zIndex: p.z,
                        }}
                      >
                        <div className="bg-white p-1.5 pb-4 shadow-[0_8px_20px_rgba(0,0,0,0.16)]">
                          <div className="aspect-[3/4] overflow-hidden bg-[#F2F2F0]">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            {o.image_url && (
                              <img
                                src={thumbUrl(o.image_url, 400)}
                                alt=""
                                className="w-full h-full object-cover group-hover/thumb:opacity-90 transition-opacity"
                              />
                            )}
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>

                {/* Caption sits below the collage */}
                <div
                  className="flex items-baseline justify-between gap-3"
                  style={{ marginTop: pick.outfits.length ? 'clamp(46px, 5vw, 74px)' : '0.75rem' }}
                >
                  <div className="min-w-0">
                    <p className="text-[9px] tracking-[0.14em] text-[#6B6B6B] truncate">{(pick.brand_name ?? '').toUpperCase()}</p>
                    <p className="text-[11px] tracking-[0.04em] text-[#4A4E57] truncate">{pick.product_name.toUpperCase()}</p>
                  </div>
                  {pick.price && <p className="text-[11px] tracking-[0.06em] text-[#4A4E57] flex-shrink-0">{pick.price}</p>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
