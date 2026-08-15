import { submitApplication } from './actions'

export const dynamic = 'force-dynamic'

const input = 'w-full border border-[#E2E0DB] rounded-[10px] px-4 py-3 text-[12px] tracking-[0.03em] bg-white focus:outline-none focus:border-[#0A0A0A]'

export default async function PartnerApplyPage({
  searchParams,
}: {
  searchParams: Promise<{ submitted?: string; error?: string }>
}) {
  const { submitted, error } = await searchParams

  return (
    <div className="min-h-screen bg-[#FAFAF8] px-6 py-16">
      <div className="max-w-[520px] mx-auto">
        <p className="text-[12px] tracking-[0.16em] text-center mb-2">MYRA × PARTNERS</p>
        <p className="text-[10px] tracking-[0.07em] text-[#A8A8A4] text-center mb-10 leading-relaxed">
          MYRA is a curated outfit platform. We hand-select a small set of brands that complement one another.
          Tell us about yours.
        </p>

        {submitted ? (
          <div className="border border-[#BBD9C2] bg-[#EAF3EC] rounded-[12px] p-6 text-center">
            <p className="text-[12px] tracking-[0.06em] text-[#3D7A50] mb-2">APPLICATION RECEIVED</p>
            <p className="text-[10px] tracking-[0.04em] text-[#4A4E57] leading-relaxed">
              Thank you — we review every application personally and will reply by email either way.
            </p>
          </div>
        ) : (
          <form action={submitApplication} className="space-y-3">
            {error && (
              <p className="text-[10px] tracking-[0.05em] text-[#B83A3A] text-center">
                {error === 'email' ? 'Please enter a valid email.' : 'Please fill in brand, store URL and email.'}
              </p>
            )}
            <input name="brand" required placeholder="BRAND NAME" className={input} />
            <input name="store" required placeholder="STORE URL (E.G. YOURBRAND.COM)" className={input} />
            <div className="grid grid-cols-2 gap-3">
              <input name="name" placeholder="CONTACT NAME" className={input} />
              <input name="email" required type="email" placeholder="CONTACT EMAIL" className={input} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <input name="category" placeholder="CATEGORY (E.G. DRESSES)" className={input} />
              <input name="price_range" placeholder="PRICE RANGE (E.G. £150–£600)" className={input} />
            </div>
            <textarea name="pitch" rows={4} placeholder="WHY DOES YOUR BRAND FIT MYRA?" className={input} />
            <button className="w-full bg-[#0A0A0A] text-white py-3.5 text-[11px] tracking-[0.14em] rounded-[10px] hover:opacity-85 transition-opacity">
              SUBMIT APPLICATION
            </button>
            <p className="text-[8px] tracking-[0.05em] text-[#A8A8A4] text-center leading-relaxed pt-2">
              Shopify stores only for now. Submitting runs an automatic store check; a human reviews every application.
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
