'use client'

// HANGER LOADER — a drawn clothes hanger swinging on its hook while the next
// set of looks is fetched AND their images are decoded. It buys the time that
// used to be spent watching pictures pop in one by one, so the grid can appear
// all at once and already sharp.

export default function HangerLoader({ label = 'PULLING THE LOOKS' }: { label?: string }) {
  return (
    <div className="w-full flex flex-col items-center justify-center py-28 select-none">
      <svg
        viewBox="0 0 120 90"
        className="w-[104px] h-[78px] myra-hanger"
        aria-hidden
      >
        {/* Hook, then the shoulders and bar — one continuous drawn line. */}
        <path
          d="M60 24 V17 a7 7 0 1 1 7-7"
          fill="none"
          stroke="#6E7278"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <path
          d="M60 24 L14 62 a3 3 0 0 0 2 5 h88 a3 3 0 0 0 2-5 L60 24 Z"
          fill="none"
          stroke="#6E7278"
          strokeWidth="3"
          strokeLinejoin="round"
        />
      </svg>

      <p className="mt-7 text-[10px] tracking-[0.28em] text-[#4A4E57]">{label}</p>

      <style jsx>{`
        .myra-hanger {
          transform-origin: 50% 12%;
          animation: myra-swing 1.5s ease-in-out infinite;
        }
        @keyframes myra-swing {
          0%,
          100% {
            transform: rotate(-9deg);
          }
          50% {
            transform: rotate(9deg);
          }
        }
        /* Someone who has asked for less motion gets a still hanger. */
        @media (prefers-reduced-motion: reduce) {
          .myra-hanger {
            animation: none;
          }
        }
      `}</style>
    </div>
  )
}
