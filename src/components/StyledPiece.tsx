'use client'

// Under MYRA STYLES FOR …: one piece and three ways MYRA would wear it — the
// Phoebe Philo aviator up top as it sits on the shop page, the three looks
// beneath. Both buttons open APPLY: on the landing they are a taste of what
// members do with any piece they find.
const PIECE = {
  src: '/styled-piece/phoebe-philo-aviator.webp',
  brand: 'PHOEBE PHILO',
  name: 'AVIATOR JACKET',
  detail: 'in dark emerald leather',
  price: '£4,700',
  url: 'https://www.phoebephilo.com/products/aviator-jacket-dark-emerald-leather',
}

const LOOKS = [
  { src: '/styled-piece/look-1.webp', name: 'WEEKEND ERRANDS' },
  { src: '/styled-piece/look-2.webp', name: 'LUNCH' },
  { src: '/styled-piece/look-3.webp', name: 'EVENING DO' },
]

const openApply = () => window.dispatchEvent(new Event('myra:open-apply'))

export default function StyledPiece() {
  return (
    <section className="relative w-full px-5 sm:px-[clamp(24px,5vw,120px)] pt-[clamp(24px,3vw,64px)] pb-[clamp(72px,8vw,180px)]">
      <div className="myra-pearl rounded-[26px] shadow-[0_24px_70px_-20px_rgba(0,0,0,0.3)] p-5 sm:p-[clamp(24px,2.4vw,56px)]">
        {/* The piece, as she found it */}
        <div className="grid grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-5 sm:gap-[clamp(24px,3vw,72px)] items-start">
          <div className="relative aspect-[4/5] rounded-[18px] overflow-hidden bg-[#D2D2D2]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={PIECE.src} alt="Phoebe Philo aviator jacket in dark emerald leather" className="absolute inset-0 w-full h-full object-cover" />
          </div>
          <div className="pt-1 sm:pt-[clamp(8px,1.5vw,40px)]">
            <p className="text-[clamp(15px,1.3vw,32px)] tracking-[0.22em] text-[#7C838B]">{PIECE.brand}</p>
            <h3 className="mt-2 sm:mt-4 text-[#0A0A0A] font-semibold uppercase tracking-[0.04em] leading-[1.1] text-[clamp(20px,2.6vw,68px)]">
              {PIECE.name}
            </h3>
            <p className="mt-1 sm:mt-2 text-[#4A4E57] tracking-[0.02em] text-[clamp(16px,1.5vw,36px)]">{PIECE.detail}</p>
            <p className="mt-3 sm:mt-6 text-[#0A0A0A] font-semibold tracking-[0.08em] text-[clamp(17px,1.6vw,40px)]">{PIECE.price}</p>
            <a
              href={PIECE.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block mt-3 sm:mt-6 text-[clamp(15px,1.2vw,28px)] tracking-[0.14em] text-[#7C838B] underline underline-offset-4 hover:text-[#0A0A0A] transition-colors"
            >
              VIEW THE PIECE
            </a>
          </div>
        </div>

        {/* Three ways to wear it */}
        <p className="mt-8 sm:mt-[clamp(32px,4vw,96px)] text-[clamp(16px,1.4vw,36px)] tracking-[0.22em] font-semibold text-[#0A0A0A]">
          THREE WAYS TO WEAR IT
        </p>
        <div className="mt-4 sm:mt-6 grid grid-cols-3 gap-2.5 sm:gap-4">
          {LOOKS.map((look) => (
            <figure key={look.src} className="rounded-[18px] overflow-hidden bg-white">
              <div className="relative aspect-[3/4] bg-[#E4E3E0]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={look.src} alt={`The aviator jacket styled for ${look.name.toLowerCase()}`} className="absolute inset-0 w-full h-full object-cover" />
              </div>
              <figcaption className="px-[0.8em] py-[0.8em] text-[clamp(12px,1.35vw,30px)] sm:text-[clamp(16px,1.35vw,30px)] tracking-[0.04em] sm:tracking-[0.1em] font-semibold text-[#0A0A0A] leading-[1.25] min-h-[3.3em]">
                {look.name}
              </figcaption>
            </figure>
          ))}
        </div>

        <div className="mt-5 sm:mt-8 grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-4">
          <button
            type="button"
            onClick={openApply}
            className="rounded-[10px] bg-[#0A0A0A] text-white py-[1em] text-[clamp(15px,1.3vw,30px)] tracking-[0.18em] font-semibold hover:opacity-85 transition-opacity"
          >
            SAVE TO WARDROBE
          </button>
          <button
            type="button"
            onClick={openApply}
            className="rounded-[10px] border-2 border-[#0A0A0A] text-[#0A0A0A] py-[1em] text-[clamp(15px,1.3vw,30px)] tracking-[0.18em] font-semibold hover:bg-white/70 transition-colors"
          >
            SOURCE ITEMS
          </button>
        </div>
      </div>
    </section>
  )
}
