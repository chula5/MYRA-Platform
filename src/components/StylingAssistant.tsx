// YOUR STYLING ASSISTANT — three ideas as full-width rows that STACK as you
// scroll: each row is sticky at an increasing top offset and tall enough to
// give scroll room, so an earlier row collapses to its header strip while the
// next rises and pins beneath it (the "Our Services" effect). Pure CSS, no JS.
//
// Both the section and every row use `myra-texture`; because that texture is a
// viewport-fixed background, the stacked rows cover each other seamlessly and
// the whole block matches the rest of the (grey) landing page.
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
    <section className="myra-texture text-[#4A4E57]">
      <div className="px-6 lg:px-16 pt-24 sm:pt-32 pb-6 sm:pb-10">
        <h2 className="uppercase font-semibold tracking-[0.03em] leading-[1.0] text-[#4A4E57] text-[clamp(30px,5vw,72px)]">
          Your Styling Assistant
        </h2>
      </div>

      {ROWS.map((r, i) => (
        <div
          key={r.n}
          className="myra-texture sticky min-h-[54vh] px-6 lg:px-16"
          style={{ top: `${8 + i * 6}rem` }}
        >
          <div className="grid grid-cols-12 gap-x-6 gap-y-3 border-t border-[#4A4E57]/25 pt-8 sm:pt-10">
            <div className="col-span-2 sm:col-span-1 text-[clamp(18px,1.6vw,28px)] tracking-[0.06em] text-[#4A4E57]">
              {r.n}
            </div>
            <div className="col-span-10 sm:col-span-6 uppercase font-semibold tracking-[0.03em] leading-[1.05] text-[#4A4E57] text-[clamp(24px,2.7vw,46px)]">
              {r.title}
            </div>
            <div className="col-span-12 sm:col-span-5 sm:col-start-8 uppercase tracking-[0.05em] leading-[1.6] text-[#6B6B6B] text-[clamp(14px,1.15vw,19px)] sm:pt-2">
              {r.text}
            </div>
          </div>
        </div>
      ))}
    </section>
  )
}
