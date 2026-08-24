'use client'

// A curated collection of complete LOOKS (e.g. /picks/mint), as opposed to the
// product collections rendered by PicksCollectionClient. Same oversized
// headline hanging over the grid and the same scattered rhythm, but each tile
// is a whole outfit that opens its outfit page rather than a shoppable piece
// with a retailer link.

import { useRouter } from 'next/navigation'
import { thumbUrl } from '@/lib/image-utils'
import type { PickOutfit } from '@/lib/our-picks'

// Alternating drops so the grid reads as a scatter, not a table — mirrors the
// product collection's rhythm at outfit proportions (looks are always 3:4).
const DROP = ['', 'sm:mt-20', 'sm:mt-6', 'sm:-mt-10', 'sm:mt-14', 'sm:mt-2']

export default function PicksOutfitsClient({
  title,
  outfits,
}: {
  title: string
  outfits: PickOutfit[]
}) {
  const router = useRouter()

  return (
    <div className="w-full px-6 sm:px-10 py-14">
      <a
        href="/"
        className="inline-flex items-center gap-2.5 border border-[#0A0A0A] text-[#4A4E57] px-6 py-3 rounded-full text-[13px] tracking-[0.16em] hover:bg-[#0A0A0A] hover:text-white transition-colors duration-300"
      >
        <span className="text-[16px] leading-none">←</span> BACK TO MYRA
      </a>

      <h1
        className="relative z-10 font-bold leading-[0.88] tracking-[-0.02em] text-[#4A4E57] uppercase text-center mt-8 pointer-events-none"
        style={{ fontSize: 'clamp(64px, 12vw, 190px)', marginBottom: '-0.42em' }}
      >
        {title}
      </h1>

      {outfits.length === 0 ? (
        <p className="text-[11px] tracking-[0.12em] text-[#4A4E57] py-20 text-center">NOTHING HERE YET — CHECK BACK SOON.</p>
      ) : (
        <div className="relative z-0 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-14 pt-[0.1em]">
          {outfits.map((o, i) => (
            <button
              key={o.outfit_id}
              onClick={() => router.push(`/outfit/${o.outfit_id}`)}
              className={`group block w-full text-left ${DROP[i % DROP.length]}`}
            >
              <div className="aspect-[3/4] bg-[#EDEDEB] overflow-hidden">
                {o.image_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={thumbUrl(o.image_url, 900)}
                    alt={o.label}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                  />
                )}
              </div>
              {o.label && (
                <p className="mt-3 text-[11px] tracking-[0.06em] text-[#4A4E57] uppercase truncate">{o.label}</p>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
