'use client'

import { useState } from 'react'

// A brand tile that shows the brand's logo when we have one, and cleanly falls
// back to a text wordmark when the logo is missing, broken, or blocked. Keeps
// the row consistent even though the scraped logos are best-effort.
export default function BrandLogoTile({ brand, logoUrl }: { brand: string; logoUrl?: string }) {
  const [failed, setFailed] = useState(false)
  const showLogo = !!logoUrl && !failed

  return (
    <div className="aspect-square w-full flex items-center justify-center px-5 transition-opacity duration-300 group-hover:opacity-70">
      {showLogo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl}
          alt={brand}
          loading="lazy"
          onError={() => setFailed(true)}
          className="max-h-[52%] max-w-[86%] object-contain mix-blend-multiply"
        />
      ) : (
        <span className="text-[14px] sm:text-[16px] tracking-[0.14em] text-[#4A4E57] text-center leading-[1.25] uppercase">
          {brand}
        </span>
      )}
    </div>
  )
}
