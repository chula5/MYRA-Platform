import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

interface OutfitRow {
  outfit_id: string
  image_url: string | null
  aesthetic_label: string | null
  status: string | null
  outfit_item: { outfit_item_id: string }[] | null
}

export default async function SocialPostsPage() {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('outfit')
    .select('outfit_id, image_url, aesthetic_label, status, outfit_item(outfit_item_id)')
    .order('created_at', { ascending: false })
  const outfits = ((data ?? []) as unknown as OutfitRow[])

  return (
    <div>
      <div className="mb-8">
        <p className="text-[11px] tracking-[0.113em] text-[#6B6B6B] mb-2">MYRA ADMIN STUDIO</p>
        <h1 className="text-[28px] tracking-[0.045em] text-[#4A4E57]">SOCIAL MEDIA POSTS</h1>
        <p className="mt-3 max-w-[680px] text-[11px] tracking-[0.054em] text-[#6B6B6B] leading-relaxed">
          Pick an outfit to turn it into a <span className="text-[#4A4E57]">Shop-the-look</span> post — a 3:4
          Instagram/reel design built automatically from the outfit&rsquo;s display image and its items (brand,
          name, price, photo). Click one to open the design, then screen-record it for a reel.
        </p>
      </div>

      {outfits.length === 0 ? (
        <p className="text-[10px] tracking-[0.068em] text-[#A8A8A4]">NO OUTFITS YET.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {outfits.map((o) => {
            const count = o.outfit_item?.length ?? 0
            return (
              <Link
                key={o.outfit_id}
                href={`/admin/social/${o.outfit_id}`}
                className="group border border-[#E2E0DB] bg-white rounded-[12px] overflow-hidden hover:border-[#0A0A0A] transition-colors"
              >
                <div className="aspect-[3/4] bg-[#F8F8F6] overflow-hidden relative">
                  {o.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={o.image_url}
                      alt=""
                      className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-500"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[9px] tracking-[0.068em] text-[#A8A8A4]">
                      NO IMAGE
                    </div>
                  )}
                  {o.status === 'live' && (
                    <span className="absolute top-2 left-2 text-[8px] tracking-[0.072em] text-white bg-[#0A0A0A]/70 px-2 py-1 rounded-[10px]">
                      LIVE
                    </span>
                  )}
                </div>
                <div className="p-2.5">
                  <p className="text-[10px] tracking-[0.045em] text-[#4A4E57] truncate">
                    {(o.aesthetic_label || 'Untitled').toUpperCase()}
                  </p>
                  <p className="text-[8px] tracking-[0.068em] text-[#A8A8A4] mt-1">
                    {count} ITEM{count === 1 ? '' : 'S'} · MAKE POST →
                  </p>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
