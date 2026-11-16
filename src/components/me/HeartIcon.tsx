// The heart, drawn once. Every heart on a piece (SavePieceHeart, the Browse
// card, anywhere else she keeps something) uses this outline so they all read
// as the same, proper heart. Chloe, 2026-11-08: "make the heart a proper heart".

export default function HeartIcon({ filled = false, className = 'w-5 h-5' }: { filled?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill={filled ? 'currentColor' : 'none'} stroke="currentColor" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
        d="M12 20.5l-1.3-1.2C5.6 14.7 2.5 11.9 2.5 8.4 2.5 5.6 4.7 3.5 7.5 3.5c1.7 0 3.4.8 4.5 2.1 1.1-1.3 2.8-2.1 4.5-2.1 2.8 0 5 2.1 5 4.9 0 3.5-3.1 6.3-8.2 10.9L12 20.5z"
      />
    </svg>
  )
}
