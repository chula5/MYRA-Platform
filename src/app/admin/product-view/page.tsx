import { createAdminClient } from '@/lib/supabase-server'
import ProductViewManager, { type Clip } from './ProductViewManager'

export const dynamic = 'force-dynamic'

export default async function ProductViewPage() {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('product_view_clip' as any)
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) {
    return (
      <div>
        <div className="mb-8">
          <p className="text-[10px] tracking-[0.25em] text-[#6B6B6B] mb-1">ADMIN</p>
          <h1 className="text-[22px] tracking-[0.10em] text-[#0A0A0A]">PRODUCT VIEW</h1>
        </div>
        <div className="border border-[#E8D9B8] bg-[#FBF6EA] rounded-[3px] p-5 max-w-[640px]">
          <p className="text-[11px] tracking-[0.18em] text-[#8A7A4E] mb-3">DATABASE TABLE NOT YET CREATED</p>
          <p className="text-[10px] tracking-[0.12em] text-[#8A7A4E] leading-relaxed mb-3">
            Run migration <span className="font-mono">0009_product_view.sql</span> in your Supabase SQL Editor:
          </p>
          <pre className="text-[9px] bg-white border border-[#E8D9B8] p-3 rounded overflow-x-auto text-[#6B6B6B] leading-relaxed">{`CREATE TABLE IF NOT EXISTS public.product_view_clip (
  clip_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title      text NOT NULL,
  caption    text,
  video_url  text NOT NULL,
  poster_url text,
  sort_order int  NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_view_clip_sort_idx
  ON public.product_view_clip (sort_order ASC, created_at ASC);
ALTER TABLE public.product_view_clip ENABLE ROW LEVEL SECURITY;`}</pre>
        </div>
      </div>
    )
  }

  return <ProductViewManager clips={(data ?? []) as unknown as Clip[]} />
}
