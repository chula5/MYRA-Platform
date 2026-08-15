import { redirect } from 'next/navigation'
import { createServerClient, createAdminClient } from '@/lib/supabase-server'
import { getPartnerContext } from '@/lib/partners/auth'
import { updateBillingDetails } from './actions'
import AcceptTermsButton from './SettingsClient'

export const dynamic = 'force-dynamic'

export default async function PartnerSettings() {
  const ctx = await getPartnerContext()
  if (!ctx) redirect('/partners/login')

  const supabase = await createServerClient()
  const admin = createAdminClient()
  const [{ data: terms }, { data: merchant }] = await Promise.all([
    supabase.from('commission_terms' as any).select('*').eq('merchant_id', ctx.merchantId).order('version', { ascending: false }).limit(1),
    admin.from('merchant' as any).select('billing_contact_email, vat_number, return_window_days, billing_model').eq('merchant_id', ctx.merchantId).single(),
  ])
  const t = (((terms as any[]) ?? [])[0]) ?? null
  const m = merchant as any

  return (
    <div className="max-w-2xl">
      <h1 className="text-[20px] tracking-[0.05em] text-[#4A4E57] mb-8">SETTINGS</h1>

      <div className="border border-[#E2E0DB] bg-white rounded-[12px] p-6 mb-6">
        <p className="text-[10px] tracking-[0.099em] text-[#6B6B6B] mb-4">COMMISSION TERMS</p>
        {t ? (
          <>
            <p className="text-[12px] tracking-[0.02em] text-[#4A4E57] leading-relaxed">
              Version {t.version}: {(Number(t.base_rate) * 100).toFixed(0)}% base
              {t.intro_rate != null && <> · {(Number(t.intro_rate) * 100).toFixed(0)}% introductory until {new Date(t.intro_expires_at).toLocaleDateString('en-GB')}</>}
              {' '}· {m?.return_window_days ?? 30}-day return window
            </p>
            {t.terms_text && <p className="text-[10px] text-[#6B6B6B] mt-2 leading-relaxed">{t.terms_text}</p>}
            <div className="mt-4">
              {t.accepted_at
                ? <p className="text-[9px] tracking-[0.08em] text-[#3D7A50]">ACCEPTED {new Date(t.accepted_at).toLocaleDateString('en-GB')}</p>
                : ctx.role === 'owner'
                  ? <AcceptTermsButton termsId={t.terms_id} />
                  : <p className="text-[9px] tracking-[0.08em] text-[#8B5E00]">AWAITING ACCEPTANCE BY THE ACCOUNT OWNER</p>}
            </div>
          </>
        ) : (
          <p className="text-[10px] text-[#A8A8A4]">Terms are being prepared by MYRA.</p>
        )}
      </div>

      <form action={updateBillingDetails} className="border border-[#E2E0DB] bg-white rounded-[12px] p-6">
        <p className="text-[10px] tracking-[0.099em] text-[#6B6B6B] mb-4">BILLING DETAILS {ctx.role !== 'owner' && '(OWNER ONLY)'}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="block text-[9px] tracking-[0.08em] text-[#6B6B6B] mb-1">BILLING CONTACT EMAIL</span>
            <input name="billing_email" defaultValue={m?.billing_contact_email ?? ''} disabled={ctx.role !== 'owner'}
              className="w-full border border-[#E2E0DB] rounded-[8px] px-3 py-2 text-[11px] disabled:bg-[#FAFAF8]" />
          </label>
          <label className="block">
            <span className="block text-[9px] tracking-[0.08em] text-[#6B6B6B] mb-1">VAT NUMBER (IF APPLICABLE)</span>
            <input name="vat" defaultValue={m?.vat_number ?? ''} disabled={ctx.role !== 'owner'}
              className="w-full border border-[#E2E0DB] rounded-[8px] px-3 py-2 text-[11px] disabled:bg-[#FAFAF8]" />
          </label>
        </div>
        {ctx.role === 'owner' && (
          <button className="mt-4 bg-[#0A0A0A] text-white px-5 py-2 text-[10px] tracking-[0.12em] rounded-full hover:opacity-85">SAVE</button>
        )}
      </form>

      <p className="text-[9px] tracking-[0.05em] text-[#A8A8A4] mt-6 leading-relaxed">
        Billing model: {String(m?.billing_model ?? 'prefunded').toUpperCase()}. Signed in as {ctx.email} ({ctx.role.toUpperCase()}).
      </p>
    </div>
  )
}
