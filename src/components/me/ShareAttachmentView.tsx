'use client'

// WHAT WAS SHARED — an outfit, a piece, or a link, drawn inside a chat bubble
// the way the rest of MYRA draws them: the picture when there is one, else the
// pieces laid across on stone; a piece as its tile; a link as its address.

import FallbackImage from '@/components/FallbackImage'
import type { ShareAttachment } from '@/app/me/sharing/actions'

const price = (n: number | null | undefined) => (typeof n === 'number' && n > 0 ? `£${Math.round(n)}` : '')

export default function ShareAttachmentView({ attachment: a, compact = false }: { attachment: ShareAttachment; compact?: boolean }) {
  if (a.kind === 'look') {
    const cols = a.items.length >= 4 ? 'grid-cols-4' : a.items.length === 3 ? 'grid-cols-3' : 'grid-cols-2'
    return (
      <div className="rounded-[16px] overflow-hidden bg-white">
        {a.image_url ? (
          <div className={`relative ${compact ? 'aspect-[4/5]' : 'aspect-[3/4]'} bg-[#E4E2DD]`}>
            <FallbackImage src={a.image_url} thumbWidth={700} alt="" className="absolute inset-0 w-full h-full object-cover" />
          </div>
        ) : (
          <div className={`grid ${cols} gap-[3px] p-[3px] bg-[#E4E2DD]`}>
            {a.items.slice(0, 8).map((it, i) => (
              <div key={i} className="relative aspect-[3/4] bg-white overflow-hidden">
                {it.image_url && <FallbackImage src={it.image_url} thumbWidth={300} alt={it.product_name} className="absolute inset-0 w-full h-full object-contain" />}
              </div>
            ))}
          </div>
        )}
        <div className="px-4 py-3">
          {a.occasion_label && <p className="text-[14px] sm:text-[15px] tracking-[0.14em] text-[#7C838B] mb-1">{a.occasion_label.toUpperCase()}</p>}
          <ul className="space-y-1">
            {a.items.slice(0, compact ? 4 : 8).map((it, i) => (
              <li key={i} className="myra-guide-text normal-case flex items-baseline justify-between gap-3 text-[16px] sm:text-[17px] text-[#2B2B2B]">
                {it.url ? (
                  <a href={it.url} target="_blank" rel="noreferrer" className="min-w-0 truncate underline-offset-4 hover:underline">
                    <span className="text-[#55534E]">{it.brand}</span>{it.brand ? ' · ' : ''}{it.product_name}
                  </a>
                ) : (
                  <span className="min-w-0 truncate"><span className="text-[#55534E]">{it.brand}</span>{it.brand ? ' · ' : ''}{it.product_name}</span>
                )}
                <span className="shrink-0 text-[#55534E]">{price(it.price_gbp)}</span>
              </li>
            ))}
            {a.items.length > (compact ? 4 : 8) && <li className="myra-guide-text normal-case text-[15px] text-[#7C838B]">and {a.items.length - (compact ? 4 : 8)} more</li>}
          </ul>
        </div>
      </div>
    )
  }
  if (a.kind === 'piece') {
    const inner = (
      <>
        <div className="relative w-[96px] sm:w-[120px] shrink-0 aspect-[3/4] bg-[#F3F2F0]">
          {a.image_url && <FallbackImage src={a.image_url} thumbWidth={300} alt={a.product_name} className="absolute inset-0 w-full h-full object-cover" />}
        </div>
        <div className="min-w-0 px-4 py-3 self-center">
          {a.brand && <p className="text-[14px] sm:text-[15px] tracking-[0.14em] text-[#7C838B] truncate">{a.brand.toUpperCase()}</p>}
          <p className="myra-guide-text normal-case text-[17px] sm:text-[18px] text-[#2B2B2B] leading-snug line-clamp-2">{a.product_name}</p>
          {price(a.price_gbp) && <p className="myra-guide-text normal-case text-[16px] text-[#55534E] mt-1">{price(a.price_gbp)}</p>}
          {a.url && <p className="text-[14px] tracking-[0.12em] text-[#2B2B2B] mt-2">SEE IT ↗</p>}
        </div>
      </>
    )
    const cls = 'flex rounded-[16px] overflow-hidden bg-white text-left'
    return a.url ? <a href={a.url} target="_blank" rel="noreferrer" className={cls}>{inner}</a> : <div className={cls}>{inner}</div>
  }
  // A link.
  let host = ''
  try { host = new URL(a.url).hostname.replace(/^www\./, '') } catch { /* shown as given */ }
  return (
    <a href={a.url} target="_blank" rel="noreferrer" className="flex rounded-[16px] overflow-hidden bg-white">
      {a.image_url && (
        <div className="relative w-[96px] shrink-0 aspect-square bg-[#F3F2F0]">
          <FallbackImage src={a.image_url} thumbWidth={300} alt="" className="absolute inset-0 w-full h-full object-cover" />
        </div>
      )}
      <div className="min-w-0 px-4 py-3 self-center">
        <p className="myra-guide-text normal-case text-[17px] sm:text-[18px] text-[#2B2B2B] leading-snug line-clamp-2">{a.title || a.url}</p>
        {host && <p className="text-[14px] tracking-[0.12em] text-[#7C838B] mt-1 truncate">{host.toUpperCase()} ↗</p>}
      </div>
    </a>
  )
}
