// YOUR STYLING ASSISTANT — on desktop the heading + first box pin together and
// the three full-width rows STACK flush on scroll (each row's sticky top+height
// kept equal so they release together and never fall apart). On mobile the
// scroll-stacking is switched off (`static` below `sm`) and the rows are a plain
// vertical list, which reads cleanly on a narrow screen. Section + rows use
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
      <div className="col-span-2 sm:col-span-1 text-[clamp(22px,2.4vw,46px)] tracking-[0.05em] text-[#4A4E57]">{n}</div>
      <div className="col-span-10 sm:col-span-5 uppercase font-semibold tracking-[0.02em] leading-[1.02] text-[#4A4E57] text-[clamp(32px,4.4vw,74px)]">{title}</div>
      <div className="col-span-12 sm:col-span-6 uppercase tracking-[0.03em] leading-[1.4] text-[#6B6B6B] text-[clamp(19px,2.3vw,44px)] sm:pt-1">{text}</div>
    </div>
  )
}

export default function StylingAssistant() {
  return (
    <section className="myra-texture text-[#4A4E57] pt-16 sm:pt-0 pb-[10vh] sm:pb-[8vh]">
      {/* Heading + first box pinned together on desktop; plain flow on mobile. */}
      <div className="myra-texture static sm:sticky sm:top-[26vh] min-h-0 sm:min-h-[calc(40vh+30.5rem)] px-6 lg:px-16 mb-10 sm:mb-0">
        <h2 className="uppercase font-semibold tracking-[0.03em] leading-[1.02] text-[#4A4E57] text-[clamp(34px,5.2vw,82px)] mb-6 sm:mb-14">
          Your Styling Assistant
        </h2>
        <Row {...ROWS[0]} />
      </div>

      <div className="myra-texture static sm:sticky min-h-0 sm:min-h-[calc(40vh+11rem)] px-6 lg:px-16 mb-10 sm:mb-0" style={{ top: 'calc(26vh + 19.5rem)' }}>
        <Row {...ROWS[1]} />
      </div>
      <div className="myra-texture static sm:sticky min-h-0 sm:min-h-[40vh] px-6 lg:px-16" style={{ top: 'calc(26vh + 30.5rem)' }}>
        <Row {...ROWS[2]} />
      </div>
    </section>
  )
}
