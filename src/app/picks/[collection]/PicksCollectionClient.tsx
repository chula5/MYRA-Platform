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
      <a href="/" className="text-[10px] tracking-[0.14em] text-[#A8A8A4] hover:text-[#4A4E57] transition-colors">
        ← BACK TO MYRA
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
            return (
              <div key={pick.item_id} className={s.wrap}>
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
                  <div className="flex items-baseline justify-between gap-3 mt-3">
                    <div className="min-w-0">
                      <p className="text-[9px] tracking-[0.14em] text-[#6B6B6B] truncate">{(pick.brand_name ?? '').toUpperCase()}</p>
                      <p className="text-[11px] tracking-[0.04em] text-[#4A4E57] truncate">{pick.product_name.toUpperCase()}</p>
                    </div>
                    {pick.price && <p className="text-[11px] tracking-[0.06em] text-[#4A4E57] flex-shrink-0">{pick.price}</p>}
                  </div>
                </button>

                {/* The outfits it lives in — small thumbs, click through to the look */}
                {pick.outfits.length > 0 && (
                  <div className="mt-3">
                    <p className="text-[8px] tracking-[0.18em] text-[#A8A8A4] mb-1.5">WEAR IT LIKE THIS</p>
                    <div className="flex gap-2">
                      {pick.outfits.map((o) => (
                        <button
                          key={o.outfit_id}
                          onClick={() => router.push(`/outfit/${o.outfit_id}`)}
                          className="w-[64px] flex-shrink-0 group/thumb"
                        >
                          <div className="aspect-[3/4] rounded-[6px] overflow-hidden bg-[#F2F2F0]">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            {o.image_url && (
                              <img src={thumbUrl(o.image_url, 300)} alt="" className="w-full h-full object-cover group-hover/thumb:opacity-85 transition-opacity" />
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
