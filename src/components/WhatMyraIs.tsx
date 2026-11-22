// WHAT MYRA IS — plain words, server-rendered, for anyone (or any reviewer)
// arriving cold: what the service does. How MYRA uses a member's Google
// account (Gmail / Calendar, Limited Use) lives in the privacy policy, linked
// from the footer — Google's reviewers follow that link.

const BODY = 'tracking-[0.02em] leading-[1.5] text-[#4A4E57] normal-case [text-transform:none] text-[clamp(17px,1.5vw,24px)]'

export default function WhatMyraIs() {
  return (
    <section id="what-myra-is" className="myra-texture px-6 lg:px-16 pt-[6vh] pb-[10vh] border-t border-[#4A4E57]/25">
      <h2 className="uppercase font-semibold tracking-[0.03em] leading-[1.02] text-[#4A4E57] text-[clamp(30px,4.4vw,74px)] mb-8 sm:mb-12">
        What MYRA is
      </h2>

      <div className="max-w-[1100px] space-y-5">
        <p className={BODY}>
          MYRA is your personal styling assistant. Tell her your favourite brands, your size and your budget, and
          MYRA builds complete outfits for you: for a wedding, a weekend away, a Monday meeting. Every look is made
          of pieces that are in stock in your size, and every piece is shoppable from the brand itself.
        </p>
        <p className={BODY}>
          MYRA keeps a wardrobe of what you already own, styles new pieces with it, watches your brands for new
          arrivals and sales, and sends you looks for what is coming up. Membership is by application.
        </p>
      </div>
    </section>
  )
}
