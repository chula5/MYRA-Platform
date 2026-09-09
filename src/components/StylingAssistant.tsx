// YOUR STYLING ASSISTANT — an editorial numbered list whose rows STACK as you
// scroll: each row is sticky at an increasing top offset, so an earlier row
// collapses to its header strip while the next opens beneath it (the "Our
// Services" effect). Pure CSS — no JS. White section for contrast with the grey
// manifesto above it.
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
    <section className="bg-white text-[#0A0A0A]">
      <div className="max-w-[1600px] mx-auto px-6 lg:px-12 pt-24 sm:pt-32 pb-4 sm:pb-8">
        <h2 className="font-serif leading-[0.95] tracking-[-0.01em] text-[clamp(46px,8vw,118px)]">
          Your Styling Assistant
        </h2>
      </div>

      <div className="max-w-[1600px] mx-auto px-6 lg:px-12 pb-[14vh]">
        {ROWS.map((r, i) => (
          <div
            key={r.n}
            className="sticky bg-white"
            style={{ top: `${8 + i * 6}rem` }}
          >
            <div className="grid grid-cols-1 md:grid-cols-12 gap-2 md:gap-8 items-start border-t border-black/15 pt-7 pb-14 sm:pt-9 sm:pb-20">
              <div className="md:col-span-2 text-[clamp(22px,2.2vw,34px)] tracking-[0.02em]">{r.n}</div>
              <div className="md:col-span-5 text-[clamp(26px,3vw,46px)] font-semibold tracking-[0.005em] leading-[1.02]">
                {r.title}
              </div>
              <div className="md:col-span-5 text-[clamp(16px,1.35vw,23px)] leading-[1.55] text-[#4A4E57] md:pt-1">
                {r.text}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
