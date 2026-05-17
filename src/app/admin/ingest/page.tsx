import IngestClient from './IngestClient'

export default function IngestPage() {
  return (
    <div>
      <div className="mb-10">
        <p className="text-[11px] tracking-[0.25em] text-[#6B6B6B] mb-2">ADMIN STUDIO</p>
        <h1 className="text-[28px] tracking-[0.10em] text-[#0A0A0A] mb-3">BATCH INGEST</h1>
        <p className="text-[12px] tracking-[0.10em] text-[#6B6B6B] max-w-2xl leading-relaxed">
          TWO MODES. URL LIST: PASTE PRODUCT URLS YOU&apos;VE ALREADY GATHERED. COLLECTION
          PAGE: PASTE A SINGLE BRAND OR RETAILER COLLECTION URL — CLAUDE BROWSES IT,
          CURATES 12–20 PRODUCTS AGAINST YOUR TASTE PROFILE, AND QUEUES THEM. EVERY
          QUEUED ITEM IS PRE-SCORED AGAINST THE MYRA TAXONOMY. BULK-APPROVE TO LAND
          THEM IN THE LIBRARY AS DRAFTS.
        </p>
      </div>
      <IngestClient />
    </div>
  )
}
