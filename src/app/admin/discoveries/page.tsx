import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase-server'
import DiscoveryActions from './DiscoveryActions'

const TABS = ['new', 'saved', 'dismissed'] as const

interface PageProps {
  searchParams: Promise<{ status?: string }>
}

interface DiscoveryRow {
  discovered_id: string
  source_item_id: string | null
  title: string
  brand_name: string | null
  retailer_url: string | null
  image_url: string | null
  price: string | null
  currency: string | null
  why_interesting: string | null
  status: 'new' | 'saved' | 'dismissed'
  created_at: string
  item: { product_name: string } | null
}

export default async function DiscoveriesPage({ searchParams }: PageProps) {
  const { status } = await searchParams
  const activeTab = (TABS as readonly string[]).includes(status ?? '') ? (status as typeof TABS[number]) : 'new'

  const supabase = createAdminClient()
  const { data } = await supabase
    .from('discovered_item')
    .select('*, item:source_item_id(product_name)')
    .eq('status', activeTab)
    .order('created_at', { ascending: false })

  const discoveries = (data ?? []) as unknown as DiscoveryRow[]

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <p className="text-[11px] tracking-[0.25em] text-[#6B6B6B] mb-2">ADMIN STUDIO</p>
        <h1 className="text-[28px] tracking-[0.10em] text-[#0A0A0A]">DISCOVERIES</h1>
        <p className="mt-2 text-[10px] tracking-[0.15em] text-[#A8A8A4]">
          AI-SURFACED PIECES SIMILAR TO ITEMS IN YOUR LIBRARY.
        </p>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-2 mb-8 border-b border-[#E2E0DB] pb-4">
        {TABS.map((tab) => (
          <Link
            key={tab}
            href={`/admin/discoveries?status=${tab}`}
            className={`px-4 py-2 text-[10px] tracking-[0.20em] transition-all duration-300 rounded-[2px] ${
              activeTab === tab
                ? 'bg-[#0A0A0A] text-white'
                : 'border border-[#E2E0DB] text-[#6B6B6B] hover:border-[#0A0A0A] hover:text-[#0A0A0A]'
            }`}
          >
            {tab.toUpperCase()}
          </Link>
        ))}
      </div>

      {/* Grid */}
      {discoveries.length === 0 ? (
        <div className="py-20 text-center border border-[#E2E0DB] bg-white rounded-[3px]">
          <p className="text-[11px] tracking-[0.20em] text-[#A8A8A4]">
            {activeTab === 'new'
              ? 'NO NEW DISCOVERIES. OPEN AN ITEM AND CLICK ✦ DISCOVER SIMILAR.'
              : `NO ${activeTab.toUpperCase()} DISCOVERIES.`}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-5">
          {discoveries.map((d) => (
            <div key={d.discovered_id} className="bg-white border border-[#E2E0DB] rounded-[3px] overflow-hidden flex flex-col">
              {/* Image */}
              <div className="aspect-[3/4] bg-[#F2F2F0] overflow-hidden">
                {d.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={d.image_url} alt={d.title} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <span className="text-[9px] tracking-[0.15em] text-[#A8A8A4]">NO IMAGE</span>
                  </div>
                )}
              </div>

              {/* Body */}
              <div className="p-4 flex-1 flex flex-col">
                <p className="text-[9px] tracking-[0.20em] text-[#A8A8A4] mb-1">
                  {d.brand_name?.toUpperCase() ?? '—'}
                </p>
                <p className="text-[11px] tracking-[0.10em] text-[#0A0A0A] mb-2 leading-snug">
                  {d.title}
                </p>
                {d.price && (
                  <p className="text-[10px] tracking-[0.12em] text-[#6B6B6B] mb-2">
                    {d.currency ?? ''} {d.price}
                  </p>
                )}
                {d.why_interesting && (
                  <p className="text-[10px] tracking-[0.10em] text-[#6B6B6B] leading-relaxed mb-3 italic">
                    &ldquo;{d.why_interesting}&rdquo;
                  </p>
                )}
                {d.item && (
                  <p className="text-[9px] tracking-[0.15em] text-[#A8A8A4] mb-3">
                    INSPIRED BY: {d.item.product_name.toUpperCase()}
                  </p>
                )}

                <div className="mt-auto space-y-2">
                  {d.retailer_url && (
                    <a
                      href={d.retailer_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-center border border-[#E2E0DB] py-1.5 text-[9px] tracking-[0.18em] text-[#6B6B6B] hover:border-[#0A0A0A] hover:text-[#0A0A0A] transition-colors"
                    >
                      VIEW AT RETAILER ↗
                    </a>
                  )}
                  <DiscoveryActions discoveredId={d.discovered_id} currentStatus={d.status} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
