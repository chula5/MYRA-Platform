// A dress form on its stand — the mark that wiggles while MYRA is styling a
// piece and goes still when the outfits are ready. (Browse draws its own copy
// for now; move it here when that file is next committed.)
export default function Mannequin({ working, className = 'h-16' }: { working: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 64 120" className={`${className} w-auto text-[#2B2B2B] ${working ? 'myra-mirror-wiggle' : ''}`} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M32 4v8" />
      <circle cx="32" cy="4" r="2.5" />
      <path d="M22 14c0 8-3 12-6 18-3 7-2 16 4 20h24c6-4 7-13 4-20-3-6-6-10-6-18" />
      <path d="M20 52c-6 6-8 16-6 26 1 5 6 8 18 8s17-3 18-8c2-10 0-20-6-26" />
      <path d="M32 86v24" />
      <path d="M18 114c4-3 24-3 28 0" />
    </svg>
  )
}
