// YOUR STYLING ASSISTANT — the heading and the FIRST box are pinned together as
// one unit (so the gap between them is fixed in the markup and never collapses),
// sitting about a third down the screen. Boxes 02 and 03 rise and stack beneath,
// gathering in the middle one under another. Pure CSS, no JS. Section + rows use
// `myra-texture` (a viewport-fixed background) so they cover seamlessly and
// match the landing; later boxes paint over earlier ones by DOM order.
const ROWS = [
  {
    n: '01',
    title: 'COST PER WEAR',
    text: "Every piece has to earn its place. We show you what you'll reach for in a year, not what you'll wear once.",
  },
  {
    n: '02',
    title: 'NEVER ALONE',
    text: "No piece arrives on its own. You see it styled, in context, so you know where it's going before you commit.",
  },
  {
    n: '03',
    title: 'TASTE MOVES',
    text: 'Yours will change. So will what we show you.',
  },
]

function Row({ n, title, text }: { n: string; title: string; text: string }) {
  return (
    <div className="grid grid-cols-12 gap-x-6 gap-y-3 border-t border-[#4A4E57]/25 pt-7 sm:pt-9">
      <div className="col-span-2 sm:col-span-1 text-[clamp(26px,2.4vw,46px)] tracking-[0.05em] text-[#4A4E57]">{n}</div>
      <div className="col-span-10 sm:col-span-5 uppercase font-semibold tracking-[0.02em] leading-[1.02] text-[#4A4E57] text-[clamp(38px,4.4vw,74px)]">{title}</div>
      <div className="col-span-12 sm:col-span-6 uppercase tracking-[0.03em] leading-[1.4] text-[#6B6B6B] text-[clamp(24px,2.3vw,44px)] sm:pt-1">{text}</div>
    </div>
  )
}

export default function StylingAssistant() {
  return (
    <section className="myra-texture text-[#4A4E57] pb-[8vh]">
      {/* Heading + first box pinned together → their gap is fixed (mb below). */}
      <div className="myra-texture sticky top-[26vh] min-h-[64vh] px-6 lg:px-16">
        <h2 className="uppercase font-semibold tracking-[0.03em] leading-[1.0] text-[#4A4E57] text-[clamp(36px,5.2vw,82px)] mb-10 sm:mb-14">
          Your Styling Assistant
        </h2>
        <Row {...ROWS[0]} />
      </div>

      <div className="myra-texture sticky min-h-[44vh] px-6 lg:px-16" style={{ top: 'calc(26vh + 18.5rem)' }}>
        <Row {...ROWS[1]} />
      </div>
      <div className="myra-texture sticky min-h-[44vh] px-6 lg:px-16" style={{ top: 'calc(26vh + 28.5rem)' }}>
        <Row {...ROWS[2]} />
      </div>
    </section>
  )
}
