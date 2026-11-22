import Link from 'next/link'

export const metadata = {
  title: 'Privacy Policy',
  description: 'How MYRA collects, uses and protects your information.',
  alternates: { canonical: '/privacy' },
}

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-white px-6 sm:px-10 py-16">
      <div className="max-w-[760px] mx-auto">
        <Link href="/" className="text-[11px] tracking-[0.10em] text-[#6B6B6B] hover:text-[#4A4E57] transition-colors">
          ← MYRA
        </Link>

        <h1 className="text-[clamp(26px,4vw,38px)] tracking-[0.04em] text-[#4A4E57] mt-8 mb-2">PRIVACY POLICY</h1>
        <p className="text-[11px] tracking-[0.10em] text-[#A8A8A4] mb-10">LAST UPDATED: NOVEMBER 2026</p>

        <div className="space-y-8 text-[12px] sm:text-[13px] tracking-[0.03em] leading-[1.8] text-[#4A4E57] normal-case [text-transform:none]">
          <section>
            <p>
              MYRA (&ldquo;MYRA&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) is a private styling service: complete
              outfits built around your taste, your size and what you already own. This policy explains what information we collect, how we use it, and the choices you have.
              By using MYRA&rsquo;s website or app you agree to this policy.
            </p>
          </section>

          <section>
            <h2 className="text-[14px] tracking-[0.06em] text-[#4A4E57] mb-3">INFORMATION WE COLLECT</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>Account &amp; contact details</strong> — your email address when you join the waitlist or create an early-access login, and a password (stored securely, hashed, by our authentication provider).</li>
              <li><strong>Taste &amp; preference data</strong> — the brands, age range and outfits you select during sign-up, and the outfits you save or like, so we can personalise recommendations.</li>
              <li><strong>Usage data</strong> — pages viewed, buttons and links clicked (including click-throughs to retailer websites), and referral source, used to understand engagement and improve the product.</li>
              <li><strong>Technical data</strong> — basic device and browser information needed to deliver and secure the service.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-[14px] tracking-[0.06em] text-[#4A4E57] mb-3">MYRA FOR CHROME (THE MIRROR EXTENSION)</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>What it reads</strong> — only the shop pages you open in Chrome that contain a product listing or a single product: the product names, prices, images and product links on that page. It does nothing on any other page, and it never reads what you type.</li>
              <li><strong>What it sends</strong> — those product details, with your signed MYRA member token, to MYRA (myraassistant.co.uk) so we can order the page to your taste and, if you ask, save a piece or build looks around it. We do not keep a history of the sites you visit.</li>
              <li><strong>What it keeps in your browser</strong> — your MYRA connection (a signed token and your first name) and the list of sites you have switched it off for. Nothing else. Disconnecting from the extension&rsquo;s menu removes the connection.</li>
              <li><strong>What it is for</strong> — showing you the pieces you would wear first, and nothing unrelated. We do not sell or share this data, and we never use it to judge creditworthiness or for lending.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-[14px] tracking-[0.06em] text-[#4A4E57] mb-3">MYRA AND YOUR GOOGLE ACCOUNT (GMAIL &amp; CALENDAR)</h2>
            <p className="mb-3">
              Connecting your Google account is optional. You choose it from your settings, Google asks you to
              approve each permission, and you can disconnect at any time from your settings or from your Google
              Account&rsquo;s security page. Both connections are read-only.
            </p>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>Gmail (read-only)</strong> — MYRA searches your inbox only for order confirmations, receipts, dispatch and delivery emails from fashion brands and retailers, and reads those messages to find the clothes you have bought: the garment name, brand, colour, size, price, product image and link. It uses this to add the piece to your MYRA wardrobe so outfits can be built around what you own. No other mail is opened. The emails themselves are not stored; only the garment details are. MYRA never sends, modifies, labels or deletes mail.</li>
              <li><strong>Google Calendar (read-only)</strong> — MYRA reads your upcoming events (title, date, time and location) to see what you have to dress for, and shows the ones worth dressing for in your Coming up list with outfit suggestions. Only the events you choose to dress for are kept. MYRA never creates, edits or deletes events, invitations or calendars.</li>
              <li><strong>What we do with it</strong> — Google data is used solely to style you. It is never used for advertising, never sold, never shared with anyone except the processors that run MYRA (listed below), and never read by a human except with your permission, for support or security, or as the law requires. Disconnecting removes the connection and the Google tokens; you can ask us to delete the garment details and events at any time.</li>
              <li><strong>Limited Use</strong> — MYRA&rsquo;s use and transfer to any other app of information received from Google APIs will adhere to the <a href="https://developers.google.com/terms/api-services-user-data-policy" className="underline underline-offset-2" target="_blank" rel="noopener noreferrer">Google API Services User Data Policy</a>, including the Limited Use requirements.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-[14px] tracking-[0.06em] text-[#4A4E57] mb-3">HOW WE USE IT</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>To provide and personalise MYRA — curating outfits and recommendations to your taste.</li>
              <li>To operate the waitlist and early-access programme and contact you about access and launch.</li>
              <li>To understand which outfits, brands and items are popular and improve our curation.</li>
              <li>To maintain the security and reliability of the service.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-[14px] tracking-[0.06em] text-[#4A4E57] mb-3">HOW IT&rsquo;S STORED &amp; SHARED</h2>
            <p>
              Your data is stored using <strong>Supabase</strong> (our database and authentication provider) and
              hosting infrastructure that process data on our behalf. When you click through to shop an item you are
              taken to a third-party retailer, whose own privacy policy then applies. We do <strong>not</strong> sell
              your personal information.
            </p>
          </section>

          <section>
            <h2 className="text-[14px] tracking-[0.06em] text-[#4A4E57] mb-3">YOUR CHOICES &amp; RIGHTS</h2>
            <p>
              You can request access to, correction of, or deletion of your personal data at any time. Depending on
              your location you may have additional rights under laws such as the UK GDPR. To make a request, contact
              us using the details below.
            </p>
          </section>

          <section>
            <h2 className="text-[14px] tracking-[0.06em] text-[#4A4E57] mb-3">CHILDREN</h2>
            <p>MYRA is intended for adults and is not directed at children under 16.</p>
          </section>

          <section>
            <h2 className="text-[14px] tracking-[0.06em] text-[#4A4E57] mb-3">CHANGES</h2>
            <p>We may update this policy from time to time. Material changes will be reflected by the date above.</p>
          </section>

          <section>
            <h2 className="text-[14px] tracking-[0.06em] text-[#4A4E57] mb-3">CONTACT</h2>
            <p>
              Questions or requests? Email us at{' '}
              <a href="mailto:chloe@myraassistant.co.uk" className="underline underline-offset-2">chloe@myraassistant.co.uk</a>.
            </p>
          </section>
        </div>
      </div>
    </main>
  )
}
