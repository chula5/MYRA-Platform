'use client'

// The two bits of stationery that hold a pile of papers together. Both are
// drawn rather than photographed so they stay crisp and pick up the page's
// own colours; both are decorative and hidden from assistive tech.

/** Wire paperclip, slipped over the top-left corner of a pile. */
export function PaperClip({ className = '', size = 46 }: { className?: string; size?: number }) {
  return (
    <svg
      viewBox="0 0 40 96"
      width={size}
      height={size * 2.4}
      className={className}
      aria-hidden
      style={{ filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.28))' }}
    >
      {/* Outer loop, then the inner return — one stroke each, so the wire
          reads as a single folded length rather than a filled shape. */}
      <path
        d="M28 78 V22 a11 11 0 0 0-22 0 V80 a17 17 0 0 0 34 0 V26"
        fill="none"
        stroke="#B9BCC0"
        strokeWidth="4.5"
        strokeLinecap="round"
      />
      <path
        d="M28 78 V22 a11 11 0 0 0-22 0 V80"
        fill="none"
        stroke="#DDE0E3"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** Bulldog clip, clamped over the edge of a pile. */
export function BulldogClip({ className = '', size = 54 }: { className?: string; size?: number }) {
  return (
    <svg
      viewBox="0 0 64 46"
      width={size}
      height={size * 0.72}
      className={className}
      aria-hidden
      style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))' }}
    >
      {/* Body */}
      <path d="M6 40 L20 8 h24 l14 32 z" fill="#C6C9CD" />
      <path d="M6 40 L20 8 h6 L14 40 z" fill="#E4E6E9" />
      <rect x="4" y="38" width="56" height="5" rx="2.5" fill="#9BA0A6" />
      {/* The two wire handles */}
      <path d="M22 12 q10-12 20 0" fill="none" stroke="#AEB2B7" strokeWidth="3" strokeLinecap="round" />
      <path d="M26 11 q6-8 12 0" fill="none" stroke="#D6D9DC" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}
