import Link from 'next/link'
import { getOutfit } from '@/lib/admin-queries'
import LookShopperReel, { type ReelProduct } from '../LookShopperReel'

export const dynamic = 'force-dynamic'

// Head-to-toe ordering for the panel.
const SLOT_RANK: Record<string, number> = {
  accessory: 0, jewellery: 1, outerwear: 2, top: 3, dress: 3, bottom: 4, bag: 5, shoe: 6,
}
const TYPE_RANK: Record<string, number> = {
  hat: -2, hair_accessory: -2, sunglasses: -1, scarf: -1,
}

function formatPrice(price: string | null, currency: string | null): string {
  if (!price) return ''
  const sym: Record<string, string> = { GBP: '£', USD: '$', EUR: '€', AUD: 'A$', CAD: 'C$', JPY: '¥' }
  const symbol = sym[currency ?? ''] ?? ''
  const clean = String(price).replace(/\.00$/, '')
  return symbol ? `${symbol}${clean}` : `${clean}${currency ? ' ' + currency : ''}`
}

interface PageProps {
  params: Promise<{ outfitId: string }>
}

export default async function SocialPostPage({ params }: PageProps) {
  const { outfitId } = await params
  const outfit = await getOutfit(outfitId)

  const products: ReelProduct[] = (outfit?.outfit_item ?? [])
    .filter((oi) => oi.item)
    .slice()
    .sort((a, b) => {
      const ra = TYPE_RANK[(a.item as any)?.item_type] ?? SLOT_RANK[a.slot] ?? 5
      const rb = TYPE_RANK[(b.item as any)?.item_type] ?? SLOT_RANK[b.slot] ?? 5
      return ra - rb
    })
    .map((oi) => {
      const it: any = oi.item
      return {
        id: oi.outfit_item_id,
        brand: (it?.brand?.name ?? '').toUpperCase(),
        name: it?.product_name ?? 'Unknown product',
        price: formatPrice(it?.price ?? null, it?.currency ?? null),
        image: it?.image_url ?? null,
        url: it?.retailer_url ?? '',
      }
    })

  return (
    <div>
      <Link
        href="/admin/social"
        className="text-[10px] tracking-[0.09em] text-[#6B6B6B] hover:text-[#4A4E57] transition-colors duration-300 mb-6 inline-block"
      >
        ← SOCIAL MEDIA POSTS
      </Link>

      {!outfit ? (
        <p className="text-[11px] tracking-[0.113em] text-[#A8A8A4] py-24 text-center">OUTFIT NOT FOUND</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-10 items-start">
          {/* The 3:4 post */}
          <div>
            <p className="text-[10px] tracking-[0.099em] text-[#6B6B6B] mb-3">SHOP THE LOOK · 3:4 POST</p>
            <LookShopperReel heroImage={outfit.image_url} products={products} logoUrl="/myra-logo-white.png" />
          </div>

          {/* Info / how-to */}
          <div className="max-w-[420px]">
            <p className="text-[11px] tracking-[0.09em] text-[#4A4E57] mb-1">
              {(outfit.aesthetic_label || 'UNTITLED OUTFIT').toUpperCase()}
            </p>
            <p className="text-[10px] tracking-[0.068em] text-[#6B6B6B] mb-6">
              {products.length} ITEM{products.length === 1 ? '' : 'S'} · BUILT FROM THIS OUTFIT&rsquo;S DISPLAY IMAGE
            </p>

            <div className="border border-[#E2E0DB] bg-[#FAFAF8] rounded-[3px] p-4 mb-4">
              <p className="text-[10px] tracking-[0.081em] text-[#6B6B6B] leading-relaxed">
                The post auto-fills from this outfit: the <span className="text-[#4A4E57]">display image</span> is the
                backdrop, and each item becomes a <span className="text-[#4A4E57]">Shop-the-look</span> card (brand,
                name, price, photo). Press <span className="text-[#4A4E57]">REPLAY</span> to re-run the cascade, then
                screen-record the frame for an Instagram reel or post.
              </p>
            </div>

            {products.length === 0 && (
              <div className="border border-[#E8D9B8] bg-[#FBF6EA] rounded-[3px] p-4 mb-4">
                <p className="text-[10px] tracking-[0.081em] text-[#8A7A4E] leading-relaxed">
                  This outfit has no items yet, so there are no shop-the-look cards. Add items to it in Projects.
                </p>
              </div>
            )}
            {!outfit.image_url && (
              <div className="border border-[#E8D9B8] bg-[#FBF6EA] rounded-[3px] p-4">
                <p className="text-[10px] tracking-[0.081em] text-[#8A7A4E] leading-relaxed">
                  No display image set — the backdrop is empty. Set a display image (e.g. a Higgsfield shoot) on the
                  outfit for the full effect.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
