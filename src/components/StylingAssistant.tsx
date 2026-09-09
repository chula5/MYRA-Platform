// YOUR STYLING ASSISTANT — the heading + first box pin together and the three
// full-width rows STACK flush on scroll (each row's sticky top+height kept equal
// so they release together and never fall apart). This works on mobile AND
// desktop: the sticky offsets are tuned per breakpoint (bigger steps on mobile
// where the text is larger relative to the screen). Section + rows use
// `myra-texture` (a viewport-fixed background) so they cover seamlessly.
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
    <div className="grid grid-cols-12 gap-x-4 sm:gap-x-6 gap-y-2 sm:gap-y-3 border-t border-[#4A4E57]/25 pt-6 sm:pt-9">
      <div className="col-span-2 sm:col-span-1 text-[clamp(20px,2.4vw,46px)] tracking-[0.05em] text-[#4A4E57]">{n}</div>
      <div className="col-span-10 sm:col-span-5 uppercase font-semibold tracking-[0.02em] leading-[1.02] text-[#4A4E57] text-[clamp(30px,4.4vw,74px)]">{title}</div>
      <div className="col-span-12 sm:col-span-6 uppercase tracking-[0.03em] leading-[1.4] text-[#6B6B6B] text-[clamp(17px,2.3vw,44px)] sm:pt-1">{text}</div>
    </div>
  )
}

export default function StylingAssistant() {
  return (
    <section className="myra-texture text-[#4A4E57] pt-10 sm:pt-0 pb-[8vh]">
      {/* Heading + first box pinned together → their gap is fixed (mb below). */}
      <div className="myra-texture sticky top-[10vh] sm:top-[26vh] min-h-[calc(26vh+33rem)] sm:min-h-[calc(40vh+30.5rem)] px-6 lg:px-16">
        <h2 className="uppercase font-semibold tracking-[0.03em] leading-[1.02] text-[#4A4E57] text-[clamp(34px,5.2vw,82px)] mb-6 sm:mb-14">
          Your Styling Assistant
        </h2>
        <Row {...ROWS[0]} />
      </div>

      <div className="myra-texture sticky top-[calc(10vh+20rem)] sm:top-[calc(26vh+19.5rem)] min-h-[calc(26vh+13rem)] sm:min-h-[calc(40vh+11rem)] px-6 lg:px-16">
        <Row {...ROWS[1]} />
      </div>
      <div className="myra-texture sticky top-[calc(10vh+33rem)] sm:top-[calc(26vh+30.5rem)] min-h-[26vh] sm:min-h-[40vh] px-6 lg:px-16">
        <Row {...ROWS[2]} />
      </div>
    </section>
  )
}
