'use client'

import { useEffect, useState } from 'react'
import { thumbUrl } from '@/lib/image-utils'

const PLACEHOLDER = '/placeholder-outfit.jpg'

/**
 * <img> with a graceful degradation ladder for outfit/product photos:
 *
 *   1. The optimized thumbnail (Cloudinary transform, or Next's /_next/image
 *      proxy for everything else) — the fast path, served as WebP/AVIF.
 *   2. The RAW source URL, fetched directly by the user's browser with no
 *      referrer. Retailer CDNs and other bot-protected hosts often reject the
 *      server-side optimizer fetch (step 1 comes back as an error → the broken
 *      image icon) while happily serving a real browser — this step covers
 *      exactly that case.
 *   3. The local placeholder, so a dead URL degrades to something intentional
 *      instead of the browser's broken-image glyph.
 */
export default function FallbackImage({
  src,
  thumbWidth = 600,
  placeholder = PLACEHOLDER,
  onExhausted,
  alt = '',
  ...imgProps
}: {
  src: string | null | undefined
  /** Target display width for the optimized thumbnail (step 1). */
  thumbWidth?: number
  placeholder?: string
  /** Called once when even the raw source failed (as the placeholder shows). */
  onExhausted?: () => void
} & Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src' | 'placeholder'>) {
  // 0 = optimized thumb, 1 = raw source, 2 = placeholder
  const [stage, setStage] = useState<0 | 1 | 2>(0)
  useEffect(() => setStage(0), [src])

  if (!src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img {...imgProps} src={placeholder} alt={alt} />
  }

  const optimized = thumbUrl(src, thumbWidth)
  const current = stage === 0 ? optimized : stage === 1 ? src : placeholder

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...imgProps}
      src={current}
      alt={alt}
      // Hotlink protection usually keys off the Referer header — drop it when
      // we retry with the raw source so the CDN treats it as a direct visit.
      referrerPolicy={stage === 1 ? 'no-referrer' : imgProps.referrerPolicy}
      onError={() =>
        setStage((s) => {
          if (s === 0 && optimized !== src) return 1
          if (s < 2) {
            onExhausted?.()
            return 2
          }
          return s
        })
      }
    />
  )
}
