'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import type { Item, Brand, ItemType, ColourFamily, MaterialCategory, JewelleryFinish, JewelleryStyle } from '@/types/database'
import ScoreInput from '@/components/admin/ScoreInput'
import { createBrand, updateBrand } from '@/app/admin/items/actions'
import { analyseProductUrl } from '@/app/admin/items/analyse-url'
import { scrapeAndUploadToCloudinary, uploadBase64ToCloudinary } from '@/app/admin/items/cloudinary-upload'

const ITEM_TYPES: ItemType[] = [
  'coat', 'trench', 'jacket', 'blazer', 'gilet', 'cape',
  'shirt', 'blouse', 't-shirt', 'knitwear', 'corset', 'bodysuit',
  'trousers', 'jeans', 'shorts', 'skirt',
  'mini_dress', 'midi_dress', 'maxi_dress', 'shirt_dress', 'slip_dress',
  'boot', 'heel', 'flat', 'sneaker', 'mule', 'sandal',
  'tote', 'shoulder_bag', 'clutch', 'crossbody', 'structured_bag',
  'belt', 'scarf', 'necklace', 'earrings', 'bracelet', 'ring', 'brooch',
  'hair_accessory', 'hat', 'gloves', 'sunglasses',
]

const JEWELLERY_TYPES: ItemType[] = [
  'necklace', 'earrings', 'bracelet', 'ring', 'brooch', 'hair_accessory',
]

const COLOUR_FAMILIES: ColourFamily[] = [
  'white', 'cream', 'black', 'grey', 'navy', 'brown', 'camel',
  'green', 'burgundy', 'red', 'blue', 'pink', 'yellow', 'orange',
  'purple', 'multicolour',
]

const MATERIAL_CATEGORIES: MaterialCategory[] = [
  'natural_woven', 'natural_knit', 'synthetic_woven', 'synthetic_knit',
  'leather_suede', 'technical', 'mixed',
]

const JEWELLERY_FINISHES: JewelleryFinish[] = [
  'yellow_gold', 'white_gold', 'rose_gold', 'silver', 'oxidised',
  'mixed_metal', 'plated', 'resin', 'pearl', 'gemstone', 'enamel', 'organic',
]

const JEWELLERY_STYLES: JewelleryStyle[] = [
  'fine', 'costume', 'artisan', 'vintage_inspired', 'architectural',
  'organic', 'minimal', 'maximalist',
]

const PRICE_TIER_LABELS: Record<number, string> = {
  1: 'HIGH STREET',
  2: 'CONTEMPORARY',
  3: 'PREMIUM',
  4: 'LUXURY',
  5: 'ULTRA-LUXURY',
}

const inputClass =
  'w-full border border-[#E2E0DB] bg-white px-4 py-2.5 text-[12px] tracking-[0.10em] text-[#0A0A0A] focus:outline-none focus:border-[#0A0A0A] transition-colors duration-300'
const labelClass = 'text-[10px] tracking-[0.20em] text-[#6B6B6B] mb-1.5 block'
const sectionHeadingClass =
  'text-[10px] tracking-[0.25em] text-[#6B6B6B] mb-6 pb-3 border-b border-[#E2E0DB]'
const sectionClass = 'mb-10'

interface ItemFormProps {
  item?: Item & { brand?: Brand }
  brands: Brand[]
  action: (formData: FormData) => Promise<{ error?: string }>
}

export default function ItemForm({ item, brands: initialBrands, action }: ItemFormProps) {
  const router = useRouter()
  const [brands, setBrands] = useState<Brand[]>(initialBrands)
  const [itemType, setItemType] = useState<ItemType>((item?.item_type as ItemType) || 'shirt')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [showBrandForm, setShowBrandForm] = useState(false)
  const [brandFormMode, setBrandFormMode] = useState<'create' | 'edit'>('create')
  const [brandError, setBrandError] = useState<string | null>(null)
  const [brandSubmitting, setBrandSubmitting] = useState(false)

  // Auto-fill controlled state
  const [analysing, setAnalysing] = useState(false)
  const [analyseError, setAnalyseError] = useState<string | null>(null)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [uploadImageError, setUploadImageError] = useState<string | null>(null)
  const [imageUrl, setImageUrl] = useState(item?.image_url || '')
  const [productName, setProductName] = useState(item?.product_name || '')
  const [retailerUrl, setRetailerUrl] = useState(item?.retailer_url || '')
  const [price, setPrice] = useState((item as any)?.price || '')
  const [currency, setCurrency] = useState((item as any)?.currency || 'GBP')
  const [brandId, setBrandId] = useState(item?.brand_id || '')
  const [colourHex, setColourHex] = useState(item?.colour_hex || '')
  const [colourFamily, setColourFamily] = useState(item?.colour_family || '')
  const [materialPrimary, setMaterialPrimary] = useState(item?.material_primary || '')
  const [materialCategory, setMaterialCategory] = useState(item?.material_category || '')

  // Score states
  const [scores, setScores] = useState({
    fit: item?.fit ?? null,
    length: item?.length ?? null,
    rise: item?.rise ?? null,
    structure: item?.structure ?? null,
    shoulder: item?.shoulder ?? null,
    waist_definition: item?.waist_definition ?? null,
    leg_opening: item?.leg_opening ?? null,
    surface: item?.surface ?? null,
    colour_depth: item?.colour_depth ?? null,
    pattern: item?.pattern ?? null,
    sheen: item?.sheen ?? null,
    material_weight: item?.material_weight ?? null,
    material_formality: item?.material_formality ?? null,
    jewellery_scale: item?.jewellery_scale ?? null,
    jewellery_formality: item?.jewellery_formality ?? null,
  })

  const formRef = useRef<HTMLFormElement>(null)
  const isJewellery = JEWELLERY_TYPES.includes(itemType)

  // ── URL analysis ──────────────────────────────────────────────
  async function handleUrlAnalyse(url: string) {
    if (!url || !url.startsWith('http')) return
    setAnalysing(true)
    setAnalyseError(null)
    const result = await analyseProductUrl(url)
    setAnalysing(false)
    if (result.error) { setAnalyseError(result.error); return }
    const d = result.data!

    if (d.product_name) setProductName(d.product_name)
    if ((d as any).price) setPrice((d as any).price)
    if ((d as any).currency) setCurrency((d as any).currency)
    if (d.item_type && ITEM_TYPES.includes(d.item_type as ItemType)) {
      setItemType(d.item_type as ItemType)
    }
    if (d.colour_hex) setColourHex(d.colour_hex)
    if (d.colour_family) setColourFamily(d.colour_family)
    if (d.material_primary) setMaterialPrimary(d.material_primary)
    if (d.material_category) setMaterialCategory(d.material_category)

    // Match brand by name (case-insensitive)
    if (d.brand_name) {
      const matched = brands.find(
        (b) => b.name.toLowerCase() === d.brand_name!.toLowerCase()
      )
      if (matched) setBrandId(matched.brand_id)
    }

    // Update scores
    setScores((prev) => ({
      fit: d.fit ?? prev.fit,
      length: d.length ?? prev.length,
      rise: d.rise ?? prev.rise,
      structure: d.structure ?? prev.structure,
      shoulder: d.shoulder ?? prev.shoulder,
      waist_definition: d.waist_definition ?? prev.waist_definition,
      leg_opening: d.leg_opening ?? prev.leg_opening,
      surface: d.surface ?? prev.surface,
      colour_depth: d.colour_depth ?? prev.colour_depth,
      pattern: d.pattern ?? prev.pattern,
      sheen: d.sheen ?? prev.sheen,
      material_weight: d.material_weight ?? prev.material_weight,
      material_formality: d.material_formality ?? prev.material_formality,
      jewellery_scale: d.jewellery_scale ?? prev.jewellery_scale,
      jewellery_formality: d.jewellery_formality ?? prev.jewellery_formality,
    }))
  }

  async function handleCloudinaryUpload() {
    if (!retailerUrl) return
    setUploadingImage(true)
    setUploadImageError(null)

    // If a direct image URL is already in the image field, try to fetch it in
    // the browser first (bypasses CDN bot protection that blocks server fetches)
    const directUrl = imageUrl.trim()
    const isDirectImageUrl = /^https?:\/\/.+\.(jpg|jpeg|png|webp|avif)/i.test(directUrl)

    if (isDirectImageUrl) {
      try {
        const res = await fetch(directUrl)
        if (res.ok) {
          const contentType = res.headers.get('content-type') ?? 'image/jpeg'
          if (contentType.startsWith('image/')) {
            const buffer = await res.arrayBuffer()
            const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)))
            const dataUri = `data:${contentType};base64,${base64}`
            const result = await uploadBase64ToCloudinary(dataUri, directUrl)
            setUploadingImage(false)
            if (result.error) { setUploadImageError(result.error); return }
            if (result.cloudinaryUrl) setImageUrl(result.cloudinaryUrl)
            return
          }
        }
      } catch { /* fall through to server-side scrape */ }
    }

    // Server-side scrape from retailer URL
    const result = await scrapeAndUploadToCloudinary(retailerUrl)
    setUploadingImage(false)
    if (result.error) { setUploadImageError(result.error); return }
    if (result.cloudinaryUrl) setImageUrl(result.cloudinaryUrl)
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    // Manual validation since e.preventDefault() skips browser required checks
    if (!productName.trim()) { setError('Product name is required'); return }
    if (!brandId) { setError('Please select a brand'); return }
    setSubmitting(true)
    setError(null)
    const formData = new FormData(e.currentTarget)
    try {
      const result = await action(formData)
      setSubmitting(false)
      if (result?.error) {
        setError(result.error)
      } else if (!item) {
        // New item saved successfully — navigate client-side to avoid redirect issues
        router.push('/admin/items')
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred')
      setSubmitting(false)
    }
  }

  const brandNameRef = useRef<HTMLInputElement>(null)
  const brandPriceTierRef = useRef<HTMLSelectElement>(null)

  async function handleCreateBrand() {
    const name = brandNameRef.current?.value?.trim()
    if (!name) { setBrandError('Brand name is required'); return }
    setBrandSubmitting(true)
    setBrandError(null)
    const formData = new FormData()
    formData.append('name', name)
    formData.append('price_tier', brandPriceTierRef.current?.value ?? '3')
    const result = await createBrand(formData)
    setBrandSubmitting(false)
    if (result?.error) { setBrandError(result.error); return }
    if (result?.brandId) {
      const newBrand: Brand = {
        brand_id: result.brandId,
        name,
        price_tier: parseInt(brandPriceTierRef.current?.value ?? '3', 10) || 3,
        era_orientation: 3,
        aesthetic_output: 3,
        cultural_legibility: 3,
        creative_behaviour: 3,
        notes: null,
      }
      setBrands((prev) => [...prev, newBrand].sort((a, b) => a.name.localeCompare(b.name)))
      setBrandId(result.brandId)
      setShowBrandForm(false)
      if (brandNameRef.current) brandNameRef.current.value = ''
    }
  }

  async function handleUpdateBrand() {
    if (!brandId) { setBrandError('Select a brand to edit'); return }
    const name = brandNameRef.current?.value?.trim()
    if (!name) { setBrandError('Brand name is required'); return }
    setBrandSubmitting(true)
    setBrandError(null)
    const formData = new FormData()
    formData.append('name', name)
    formData.append('price_tier', brandPriceTierRef.current?.value ?? '3')
    const result = await updateBrand(brandId, formData)
    setBrandSubmitting(false)
    if (result?.error) { setBrandError(result.error); return }
    setBrands((prev) =>
      prev
        .map((b) =>
          b.brand_id === brandId
            ? { ...b, name, price_tier: parseInt(brandPriceTierRef.current?.value ?? '3', 10) || 3 }
            : b,
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    )
    setShowBrandForm(false)
  }

  function openBrandForm(mode: 'create' | 'edit') {
    setBrandFormMode(mode)
    setBrandError(null)
    setShowBrandForm(true)
    // Pre-fill refs after render
    setTimeout(() => {
      if (mode === 'edit') {
        const current = brands.find((b) => b.brand_id === brandId)
        if (brandNameRef.current) brandNameRef.current.value = current?.name ?? ''
        if (brandPriceTierRef.current) brandPriceTierRef.current.value = String(current?.price_tier ?? 3)
      } else {
        if (brandNameRef.current) brandNameRef.current.value = ''
        if (brandPriceTierRef.current) brandPriceTierRef.current.value = '3'
      }
    }, 0)
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="max-w-2xl">
      {/* IDENTITY */}
      <div className={sectionClass}>
        <p className={sectionHeadingClass}>IDENTITY</p>

        {/* Retailer URL with AI trigger */}
        <div className="mb-4">
          <label className={labelClass}>RETAILER URL</label>
          <div className="flex gap-2">
            <input
              name="retailer_url"
              type="text"
              value={retailerUrl}
              onChange={(e) => setRetailerUrl(e.target.value)}
              onBlur={(e) => handleUrlAnalyse(e.target.value)}
              placeholder="https://..."
              className={inputClass}
            />
            <button
              type="button"
              onClick={() => handleUrlAnalyse(retailerUrl)}
              disabled={analysing || !retailerUrl}
              className="shrink-0 border border-[#E2E0DB] bg-white px-4 text-[10px] tracking-[0.15em] text-[#6B6B6B] hover:border-[#0A0A0A] hover:text-[#0A0A0A] disabled:opacity-40 transition-colors whitespace-nowrap"
            >
              {analysing ? 'ANALYSING...' : 'AUTO-FILL ✦'}
            </button>
          </div>
          {analysing && (
            <p className="mt-1.5 text-[10px] tracking-[0.15em] text-[#A8A8A4] animate-pulse">
              Analysing product page with AI...
            </p>
          )}
          {analyseError && (
            <p className="mt-1.5 text-[10px] tracking-[0.15em] text-red-400">{analyseError}</p>
          )}
        </div>

        <div className="grid grid-cols-[1fr_120px] gap-4 mb-4">
          <div>
            <label className={labelClass}>PRICE</label>
            <input
              name="price"
              type="text"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="e.g. 495"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>CURRENCY</label>
            <select
              name="currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className={inputClass}
            >
              <option value="GBP">GBP £</option>
              <option value="USD">USD $</option>
              <option value="EUR">EUR €</option>
              <option value="AUD">AUD $</option>
              <option value="CAD">CAD $</option>
              <option value="JPY">JPY ¥</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className={labelClass}>ITEM TYPE</label>
            <select
              name="item_type"
              value={itemType}
              onChange={(e) => setItemType(e.target.value as ItemType)}
              className={inputClass}
              required
            >
              {ITEM_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, ' ').toUpperCase()}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>BRAND</label>
            <div className="flex gap-2">
              <select
                name="brand_id"
                className={inputClass}
                value={brandId}
                onChange={(e) => setBrandId(e.target.value)}
                required
              >
                <option value="">SELECT BRAND</option>
                {brands.map((b) => (
                  <option key={b.brand_id} value={b.brand_id}>
                    {b.name.toUpperCase()}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => openBrandForm('edit')}
                disabled={!brandId}
                title={brandId ? 'Edit selected brand' : 'Select a brand first'}
                className="shrink-0 border border-[#E2E0DB] bg-white px-3 text-[10px] tracking-[0.15em] text-[#6B6B6B] hover:border-[#0A0A0A] hover:text-[#0A0A0A] disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-300"
              >
                EDIT
              </button>
              <button
                type="button"
                onClick={() => openBrandForm('create')}
                title="Add new brand"
                className="shrink-0 border border-[#E2E0DB] bg-white px-3 text-[10px] tracking-[0.15em] text-[#6B6B6B] hover:border-[#0A0A0A] transition-colors duration-300"
              >
                +
              </button>
            </div>
          </div>
        </div>

        {/* Brand Form — create or edit (must be a div, not a form) */}
        {showBrandForm && (
          <div className="mb-4 p-4 bg-[#F8F8F6] border border-[#E2E0DB] rounded-[2px]">
            <p className="text-[9px] tracking-[0.20em] text-[#6B6B6B] mb-3">
              {brandFormMode === 'edit' ? 'EDIT BRAND' : 'NEW BRAND'}
            </p>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className={labelClass}>BRAND NAME</label>
                <input ref={brandNameRef} type="text" placeholder="Brand name" className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>PRICE TIER</label>
                <select
                  ref={brandPriceTierRef}
                  defaultValue="3"
                  className={inputClass}
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>{n} — {PRICE_TIER_LABELS[n]}</option>
                  ))}
                </select>
              </div>
            </div>
            {brandError && <p className="text-[10px] tracking-[0.15em] text-red-500 mb-3">{brandError}</p>}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={brandFormMode === 'edit' ? handleUpdateBrand : handleCreateBrand}
                disabled={brandSubmitting}
                className="bg-[#0A0A0A] text-white px-6 py-2 text-[10px] tracking-[0.20em] disabled:opacity-50"
              >
                {brandSubmitting ? 'SAVING...' : brandFormMode === 'edit' ? 'UPDATE BRAND' : 'SAVE BRAND'}
              </button>
              <button type="button" onClick={() => setShowBrandForm(false)} className="border border-[#E2E0DB] bg-transparent text-[#0A0A0A] px-6 py-2 text-[10px] tracking-[0.20em]">
                CANCEL
              </button>
            </div>
          </div>
        )}

        <div className="mb-4">
          <label className={labelClass}>PRODUCT NAME</label>
          <input
            name="product_name"
            type="text"
            value={productName}
            onChange={(e) => setProductName(e.target.value)}
            className={inputClass}
            required
          />
        </div>

        <div className="mb-4">
          <label className={labelClass}>IMAGE URL</label>
          <div className="flex gap-3 items-start">
            <div className="flex-1 min-w-0">
              <div className="flex gap-2 mb-1.5">
                <input
                  name="image_url"
                  type="text"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder="https://res.cloudinary.com/..."
                  className={inputClass}
                />
                <button
                  type="button"
                  onClick={handleCloudinaryUpload}
                  disabled={uploadingImage || !retailerUrl}
                  title="Scrape product image from retailer URL and upload to Cloudinary. For protected sites: paste the direct image URL above first, then click this button."
                  className="shrink-0 border border-[#E2E0DB] bg-white px-3 text-[10px] tracking-[0.12em] text-[#6B6B6B] hover:border-[#0A0A0A] hover:text-[#0A0A0A] disabled:opacity-40 transition-colors whitespace-nowrap"
                >
                  {uploadingImage ? 'UPLOADING...' : '☁ SAVE TO CLOUDINARY'}
                </button>
              </div>
              {uploadingImage && (
                <p className="text-[10px] tracking-[0.12em] text-[#A8A8A4] animate-pulse">Scraping image and uploading to Cloudinary...</p>
              )}
              {uploadImageError && (
                <p className="text-[10px] tracking-[0.12em] text-red-400">{uploadImageError}</p>
              )}
            </div>
            {imageUrl && (
              <img src={imageUrl} alt="preview" className="w-16 h-16 object-cover border border-[#E2E0DB] shrink-0" />
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 mb-4">
          <div>
            <label className={labelClass}>STATUS</label>
            <select name="status" defaultValue={item?.status || 'draft'} className={inputClass}>
              <option value="draft">DRAFT</option>
              <option value="ready">READY</option>
              <option value="live">LIVE</option>
              <option value="archived">ARCHIVED</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>SOURCE</label>
            <select name="source" defaultValue={item?.source || 'manual'} className={inputClass}>
              <option value="manual">MANUAL</option>
              <option value="retailer_api">RETAILER API</option>
              <option value="web_discovery">WEB DISCOVERY</option>
            </select>
          </div>
          <div className="flex items-end pb-2.5">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" name="in_inventory" defaultChecked={item?.in_inventory || false} className="w-4 h-4 accent-[#0A0A0A]" />
              <span className="text-[10px] tracking-[0.20em] text-[#6B6B6B]">IN INVENTORY</span>
            </label>
          </div>
        </div>
      </div>

      {/* FIT & SHAPE */}
      <div className={sectionClass}>
        <p className={sectionHeadingClass}>FIT & SHAPE</p>
        <div className="grid grid-cols-2 gap-x-8">
          <ScoreInput label="FIT" description="1=SKIN TIGHT → 5=OVERSIZED" name="fit" value={scores.fit} onChange={(v) => setScores((s) => ({ ...s, fit: v }))} />
          <ScoreInput label="LENGTH" description="1=CROPPED → 5=MAXI/FLOOR" name="length" value={scores.length} onChange={(v) => setScores((s) => ({ ...s, length: v }))} />
          <ScoreInput label="RISE" description="1=ULTRA LOW → 5=ULTRA HIGH" name="rise" value={scores.rise} onChange={(v) => setScores((s) => ({ ...s, rise: v }))} />
          <ScoreInput label="STRUCTURE" description="1=FULLY BONED → 5=UNSTRUCTURED" name="structure" value={scores.structure} onChange={(v) => setScores((s) => ({ ...s, structure: v }))} />
          <ScoreInput label="SHOULDER" description="1=HEAVILY PADDED → 5=OFF-SHOULDER" name="shoulder" value={scores.shoulder} onChange={(v) => setScores((s) => ({ ...s, shoulder: v }))} />
          <ScoreInput label="WAIST DEFINITION" description="1=CORSETED → 5=BOXY" name="waist_definition" value={scores.waist_definition} onChange={(v) => setScores((s) => ({ ...s, waist_definition: v }))} />
          <ScoreInput label="LEG OPENING" description="1=NARROW → 5=FLARED" name="leg_opening" value={scores.leg_opening} onChange={(v) => setScores((s) => ({ ...s, leg_opening: v }))} />
        </div>
      </div>

      {/* SURFACE & COLOUR */}
      <div className={sectionClass}>
        <p className={sectionHeadingClass}>SURFACE & COLOUR</p>
        <div className="grid grid-cols-2 gap-x-8">
          <ScoreInput label="SURFACE" description="1=CLEAN/FLAT → 5=HIGHLY PATTERNED" name="surface" value={scores.surface} onChange={(v) => setScores((s) => ({ ...s, surface: v }))} />
          <ScoreInput label="COLOUR DEPTH" description="1=PURE NEUTRAL → 5=BOLD/BRIGHT" name="colour_depth" value={scores.colour_depth} onChange={(v) => setScores((s) => ({ ...s, colour_depth: v }))} />
          <ScoreInput label="PATTERN" description="1=NONE → 5=STATEMENT PATTERN" name="pattern" value={scores.pattern} onChange={(v) => setScores((s) => ({ ...s, pattern: v }))} />
          <ScoreInput label="SHEEN" description="1=MATTE → 5=HIGH SHINE" name="sheen" value={scores.sheen} onChange={(v) => setScores((s) => ({ ...s, sheen: v }))} />
        </div>
        <div className="grid grid-cols-2 gap-4 mt-2">
          <div>
            <label className={labelClass}>COLOUR HEX</label>
            <div className="flex items-center gap-3">
              <input
                name="colour_hex"
                type="text"
                placeholder="#000000"
                value={colourHex}
                onChange={(e) => setColourHex(e.target.value)}
                className={inputClass}
                maxLength={7}
              />
              {colourHex && (
                <div className="w-8 h-8 border border-[#E2E0DB] shrink-0 rounded-[2px]" style={{ backgroundColor: colourHex }} />
              )}
            </div>
          </div>
          <div>
            <label className={labelClass}>COLOUR FAMILY</label>
            <select
              name="colour_family"
              value={colourFamily}
              onChange={(e) => setColourFamily(e.target.value)}
              className={inputClass}
            >
              <option value="">SELECT FAMILY</option>
              {COLOUR_FAMILIES.map((f) => (
                <option key={f} value={f}>{f.replace(/_/g, ' ').toUpperCase()}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* MATERIAL */}
      <div className={sectionClass}>
        <p className={sectionHeadingClass}>MATERIAL</p>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className={labelClass}>MATERIAL CATEGORY</label>
            <select
              name="material_category"
              value={materialCategory}
              onChange={(e) => setMaterialCategory(e.target.value)}
              className={inputClass}
            >
              <option value="">SELECT CATEGORY</option>
              {MATERIAL_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c.replace(/_/g, ' ').toUpperCase()}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>MATERIAL PRIMARY</label>
            <input
              name="material_primary"
              type="text"
              value={materialPrimary}
              onChange={(e) => setMaterialPrimary(e.target.value)}
              placeholder="E.G. 100% SILK"
              className={inputClass}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-8">
          <ScoreInput label="MATERIAL WEIGHT" description="1=SHEER → 5=STRUCTURAL" name="material_weight" value={scores.material_weight} onChange={(v) => setScores((s) => ({ ...s, material_weight: v }))} />
          <ScoreInput label="MATERIAL FORMALITY" description="1=CASUAL → 5=OCCASION" name="material_formality" value={scores.material_formality} onChange={(v) => setScores((s) => ({ ...s, material_formality: v }))} />
        </div>
      </div>

      {/* JEWELLERY */}
      {isJewellery && (
        <div className={sectionClass}>
          <p className={sectionHeadingClass}>JEWELLERY</p>
          <div className="grid grid-cols-2 gap-x-8">
            <ScoreInput label="JEWELLERY SCALE" description="1=MICRO → 5=SCULPTURAL" name="jewellery_scale" value={scores.jewellery_scale} onChange={(v) => setScores((s) => ({ ...s, jewellery_scale: v }))} />
            <ScoreInput label="JEWELLERY FORMALITY" description="1=EVERYDAY → 5=HAUTE JOAILLERIE" name="jewellery_formality" value={scores.jewellery_formality} onChange={(v) => setScores((s) => ({ ...s, jewellery_formality: v }))} />
          </div>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className={labelClass}>JEWELLERY FINISH</label>
              <select name="jewellery_finish" defaultValue={item?.jewellery_finish || ''} className={inputClass}>
                <option value="">SELECT FINISH</option>
                {JEWELLERY_FINISHES.map((f) => <option key={f} value={f}>{f.replace(/_/g, ' ').toUpperCase()}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>JEWELLERY STYLE</label>
              <select name="jewellery_style" defaultValue={item?.jewellery_style || ''} className={inputClass}>
                <option value="">SELECT STYLE</option>
                {JEWELLERY_STYLES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ').toUpperCase()}</option>)}
              </select>
            </div>
          </div>
          <div className="mb-4">
            <label className={labelClass}>JEWELLERY MATERIAL PRIMARY</label>
            <input name="jewellery_material_primary" type="text" defaultValue={item?.jewellery_material_primary || ''} className={inputClass} />
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" name="jewellery_layering" defaultChecked={item?.jewellery_layering || false} className="w-4 h-4 accent-[#0A0A0A]" />
            <span className="text-[10px] tracking-[0.20em] text-[#6B6B6B]">LAYERING PIECE</span>
          </div>
        </div>
      )}

      {/* NOTES */}
      <div className={sectionClass}>
        <p className={sectionHeadingClass}>NOTES</p>
        <div className="mb-4">
          <label className={labelClass}>ADMIN NOTES</label>
          <textarea name="admin_notes" rows={3} defaultValue={item?.admin_notes || ''} className={`${inputClass} resize-none`} />
        </div>
        <div>
          <label className={labelClass}>NOTES</label>
          <textarea name="notes" rows={3} defaultValue={item?.notes || ''} className={`${inputClass} resize-none`} />
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 border border-red-200 bg-red-50">
          <p className="text-[10px] tracking-[0.15em] text-red-600">{error}</p>
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="bg-[#0A0A0A] text-white px-8 py-3.5 text-[11px] tracking-[0.20em] transition-colors duration-400 hover:bg-[#333] disabled:opacity-50"
      >
        {submitting ? 'SAVING...' : 'SAVE ITEM'}
      </button>
    </form>
  )
}
