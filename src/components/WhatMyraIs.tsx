// WHAT MYRA IS — plain words, server-rendered, for anyone (or any reviewer)
// arriving cold: what the service does, and exactly what it does with a
// member's Google account when she chooses to connect Gmail or Calendar.
// Google's OAuth branding review reads the home page for this; keep it honest
// and keep the Gmail / Calendar paragraphs in step with src/lib/email/gmail.ts
// and src/lib/calendar/google.ts.
import Link from 'next/link'

const BODY = 'tracking-[0.02em] leading-[1.5] text-[#4A4E57] normal-case [text-transform:none] text-[clamp(17px,1.5vw,24px)]'
const SUB = 'uppercase tracking-[0.08em] text-[#6B6B6B] text-[clamp(15px,1.2vw,19px)] mb-3'

export default function WhatMyraIs() {
  return (
    <section id="what-myra-is" className="myra-texture px-6 lg:px-16 pt-[6vh] pb-[10vh] border-t border-[#4A4E57]/25">
      <h2 className="uppercase font-semibold tracking-[0.03em] leading-[1.02] text-[#4A4E57] text-[clamp(30px,4.4vw,74px)] mb-8 sm:mb-12">
        What MYRA is
      </h2>

      <div className="grid grid-cols-12 gap-x-6 gap-y-10">
        <div className="col-span-12 lg:col-span-6 space-y-5">
          <p className={BODY}>
            MYRA is a private styling service. A member tells MYRA her size, her brands and her taste, and MYRA
            builds complete outfits for her: for a wedding, a weekend away, a Monday meeting. Every look is made of
            pieces that are in stock in her size, and every piece is shoppable from the brand itself.
          </p>
          <p className={BODY}>
            MYRA keeps a wardrobe of what she already owns, styles new pieces with it, watches her brands for new
            arrivals and sales, and sends her looks for what is coming up. Membership is by application.
          </p>
        </div>

        <div className="col-span-12 lg:col-span-6 space-y-8">
          <div>
            <h3 className={SUB}>MYRA and your Google account</h3>
            <p className={BODY}>
              Connecting Google is optional. If a member connects <strong>Gmail</strong>, MYRA reads only order
              confirmations, receipts and dispatch emails from fashion brands and retailers, to find the clothes she
              has bought and add them to her wardrobe. The emails themselves are not kept, only the garment details.
              MYRA never sends, changes or deletes mail.
            </p>
          </div>
          <div>
            <p className={BODY}>
              If a member connects <strong>Google Calendar</strong>, MYRA reads her upcoming events to see what she
              has to dress for and suggests outfits ahead of time. MYRA never creates, edits or deletes events.
            </p>
          </div>
          <div>
            <p className={BODY}>
              Both connections are read-only, can be switched off at any time from her settings, and are used for
              nothing but styling her. MYRA&rsquo;s use of information received from Google APIs adheres to the Google
              API Services User Data Policy, including the Limited Use requirements. Full details are in our{' '}
              <Link href="/privacy" className="underline underline-offset-4 hover:opacity-60 transition-opacity">privacy policy</Link>.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
