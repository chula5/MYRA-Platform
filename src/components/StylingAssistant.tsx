// YOUR STYLING ASSISTANT — the heading pins just above the first line; the three
// full-width rows rise and STACK flush one under another right below it (each row
// is sticky at an increasing offset a row-height apart, so they end sitting one
// after the other). Pure CSS, no JS. Section + rows use `myra-texture` (a
// viewport-fixed background) so they cover seamlessly and match the landing.
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
      {/* Heading pins right above the first line and stays visible. */}
      <div className="myra-texture sticky top-[5rem] sm:top-[7rem] lg:top-[8rem] z-20 px-6 lg:px-16 pt-8 sm:pt-10 pb-4">
        <h2 className="uppercase font-semibold tracking-[0.03em] leading-[1.0] text-[#4A4E57] text-[clamp(34px,5vw,78px)]">
          Your Styling Assistant
        </h2>
      </div>

      {/* Rows stack flush, one row-height apart, just under the heading. */}
      {ROWS.map((r, i) => (
        <div
          key={r.n}
          className="myra-texture sticky min-h-[42vh] px-6 lg:px-16"
          style={{ top: `calc(14rem + ${i * 13}rem)` }}
        >
          <div className="grid grid-cols-12 gap-x-6 gap-y-3 border-t border-[#4A4E57]/25 pt-7 sm:pt-9">
            <div className="col-span-2 sm:col-span-1 text-[clamp(24px,2.2vw,40px)] tracking-[0.05em] text-[#4A4E57]">
              {r.n}
            </div>
            <div className="col-span-10 sm:col-span-5 uppercase font-semibold tracking-[0.02em] leading-[1.02] text-[#4A4E57] text-[clamp(34px,4vw,66px)]">
              {r.title}
            </div>
            <div className="col-span-12 sm:col-span-6 uppercase tracking-[0.03em] leading-[1.45] text-[#6B6B6B] text-[clamp(23px,2.1vw,40px)] sm:pt-1">
              {r.text}
            </div>
          </div>
        </div>
      ))}
    </section>
  )
}
