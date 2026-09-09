// YOUR STYLING ASSISTANT — the heading pins about a third down the screen (two
// thirds up from the bottom); the three full-width rows rise and STACK just
// beneath it, gathering in the middle of the screen one under another. Pure CSS,
// no JS. Section + rows use `myra-texture` (a viewport-fixed background) so they
// cover seamlessly and match the landing.
const ROWS = [
  {
    n: '01',
    title: 'COST PER WEAR',
    text: "Every piece has to earn its place. We show you what you'll reach for in a year, not what you'll wear once.",
  },
  {
    n: '02',
    title: 'NEVER ALONE',
    text: "No piece arrives on its own. You see it styled, in context — so you know where it's going before you commit.",
  },
  {
    n: '03',
    title: 'TASTE MOVES',
    text: 'Yours will change. So will what we show you.',
  },
]

export default function StylingAssistant() {
  return (
    <section className="myra-texture text-[#4A4E57] pb-[8vh]">
      {/* Heading pins ~a third down the screen and stays visible. */}
      <div className="myra-texture sticky top-[26vh] sm:top-[28vh] lg:top-[30vh] z-20 px-6 lg:px-16 pt-2 pb-4">
        <h2 className="uppercase font-semibold tracking-[0.03em] leading-[1.0] text-[#4A4E57] text-[clamp(36px,5.2vw,82px)]">
          Your Styling Assistant
        </h2>
      </div>

      {/* Rows gather in the middle, stacking one under another below the heading. */}
      {ROWS.map((r, i) => (
        <div
          key={r.n}
          className="myra-texture sticky min-h-[38vh] px-6 lg:px-16"
          style={{ top: `calc(40vh + ${i * 12}rem)` }}
        >
          <div className="grid grid-cols-12 gap-x-6 gap-y-3 border-t border-[#4A4E57]/25 pt-7 sm:pt-9">
            <div className="col-span-2 sm:col-span-1 text-[clamp(26px,2.4vw,46px)] tracking-[0.05em] text-[#4A4E57]">
              {r.n}
            </div>
            <div className="col-span-10 sm:col-span-5 uppercase font-semibold tracking-[0.02em] leading-[1.02] text-[#4A4E57] text-[clamp(38px,4.4vw,74px)]">
              {r.title}
            </div>
            <div className="col-span-12 sm:col-span-6 uppercase tracking-[0.03em] leading-[1.4] text-[#6B6B6B] text-[clamp(24px,2.3vw,44px)] sm:pt-1">
              {r.text}
            </div>
          </div>
        </div>
      ))}
    </section>
  )
}
