'use client'

import { useState, useRef } from 'react'
import type { Item, Brand, ItemType, ColourFamily, MaterialCategory, JewelleryFinish, JewelleryStyle } from '@/types/database'
import ScoreInput from '@/components/admin/ScoreInput'
import { createBrand } from '@/app/admin/items/actions'

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
  const [brands, setBrands] = useState<Brand[]>(initialBrands)
  const [itemType, setItemType] = useState<ItemType>((item?.item_type as ItemType) || 'shirt')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [showBrandForm, setShowBrandForm] = useState(false)
  const [brandError, setBrandError] = useState<string | null>(null)
  const [brandSubmitting, setBrandSubmitting] = useState(false)

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

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    const formData = new FormData(e.currentTarget)
    // Inject score values into formData (they're hidden inputs already, but let's be explicit)
    const result = await action(formData)
    setSubmitting(false)
    if (result?.error) {
      setError(result.error)
    }
  }

  async function handleCreateBrand(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setBrandSubmitting(true)
    setBrandError(null)
    const formData = new FormData(e.currentTarget)
    const result = await createBrand(formData)
    setBrandSubmitting(false)
    if (result?.error) {
      setBrandError(result.error)
      return
    }
    if (result?.brandId) {
      // Fetch updated brand name from form
      const newBrandName = formData.get('name') as string
      const newBrand: Brand = {
        brand_id: result.brandId,
        name: newBrandName,
        price_tier: parseInt(formData.get('price_tier') as string, 10) || 3,
        era_orientation: 3,
        aesthetic_output: 3,
        cultural_legibility: 3,
        creative_behaviour: 3,
        notes: null,
      }
      setBrands((prev) => [...prev, newBrand].sort((a, b) => a.name.localeCompare(b.name)))
      setShowBrandForm(false)
    }
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="max-w-2xl">
      {/* IDENTITY */}
      <div className={sectionClass}>
        <p className={sectionHeadingClass}>IDENTITY</p>
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
              <select name="brand_id" className={inputClass} defaultValue={item?.brand_id || ''} required>
                <option value="">SELECT BRAND</option>
                {brands.map((b) => (
                  <option key={b.brand_id} value={b.brand_id}>
                    {b.name.toUpperCase()}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setShowBrandForm((v) => !v)}
                className="shrink-0 border border-[#E2E0DB] bg-white px-3 text-[10px] tracking-[0.15em] text-[#6B6B6B] hover:border-[#0A0A0A] transition-colors duration-300"
              >
                +
              </button>
            </div>
          </div>
        </div>

        {/* Quick Brand Form */}
        {showBrandForm && (
          <form
            onSubmit={handleCreateBrand}
            className="mb-4 p-4 bg-[#F8F8F6] border border-[#E2E0DB] rounded-[2px]"
          >
            <p className="text-[9px] tracking-[0.20em] text-[#6B6B6B] mb-3">NEW BRAND</p>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className={labelClass}>BRAND NAME</label>
                <input name="name" type="text" required className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>PRICE TIER (1-5)</label>
                <input
                  name="price_tier"
                  type="number"
                  min={1}
                  max={5}
                  defaultValue={3}
                  className={inputClass}
                />
              </div>
            </div>
            {brandError && (
              <p className="text-[10px] tracking-[0.15em] text-red-500 mb-3">{brandError}</p>
            )}
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={brandSubmitting}
                className="bg-[#0A0A0A] text-white px-6 py-2 text-[10px] tracking-[0.20em] disabled:opacity-50"
              >
                {brandSubmitting ? 'SAVING...' : 'SAVE BRAND'}
              </button>
              <button
                type="button"
                onClick={() => setShowBrandForm(false)}
                className="border border-[#E2E0DB] bg-transparent text-[#0A0A0A] px-6 py-2 text-[10px] tracking-[0.20em]"
              >
                CANCEL
              </button>
            </div>
          </form>
        )}

        <div className="mb-4">
          <label className={labelClass}>PRODUCT NAME</label>
          <input
            name="product_name"
            type="text"
            defaultValue={item?.product_name || ''}
            className={inputClass}
            required
          />
        </div>
        <div className="mb-4">
          <label className={labelClass}>RETAILER URL</label>
          <input
            name="retailer_url"
            type="url"
            defaultValue={item?.retailer_url || ''}
            className={inputClass}
          />
        </div>
        <div className="mb-4">
          <label className={labelClass}>IMAGE URL</label>
          <div className="flex gap-3 items-start">
            <input
              name="image_url"
              type="url"
              defaultValue={item?.image_url || ''}
              className={inputClass}
            />
            {item?.image_url && (
              <img
                src={item.image_url}
                alt="preview"
                className="w-16 h-16 object-cover border border-[#E2E0DB] shrink-0"
              />
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
              <input
                type="checkbox"
                name="in_inventory"
                defaultChecked={item?.in_inventory || false}
                className="w-4 h-4 accent-[#0A0A0A]"
              />
              <span className="text-[10px] tracking-[0.20em] text-[#6B6B6B]">IN INVENTORY</span>
            </label>
          </div>
        </div>
      </div>

      {/* FIT & SHAPE */}
      <div className={sectionClass}>
        <p className={sectionHeadingClass}>FIT & SHAPE</p>
        <div className="grid grid-cols-2 gap-x-8">
          <ScoreInput
            label="FIT"
            description="1=SKIN TIGHT → 5=OVERSIZED"
            name="fit"
            value={scores.fit}
            onChange={(v) => setScores((s) => ({ ...s, fit: v }))}
          />
          <ScoreInput
            label="LENGTH"
            description="1=CROPPED → 5=MAXI/FLOOR"
            name="length"
            value={scores.length}
            onChange={(v) => setScores((s) => ({ ...s, length: v }))}
          />
          <ScoreInput
            label="RISE"
            description="1=ULTRA LOW → 5=ULTRA HIGH"
            name="rise"
            value={scores.rise}
            onChange={(v) => setScores((s) => ({ ...s, rise: v }))}
          />
          <ScoreInput
            label="STRUCTURE"
            description="1=FULLY BONED → 5=UNSTRUCTURED"
            name="structure"
            value={scores.structure}
            onChange={(v) => setScores((s) => ({ ...s, structure: v }))}
          />
          <ScoreInput
            label="SHOULDER"
            description="1=HEAVILY PADDED → 5=OFF-SHOULDER"
            name="shoulder"
            value={scores.shoulder}
            onChange={(v) => setScores((s) => ({ ...s, shoulder: v }))}
          />
          <ScoreInput
            label="WAIST DEFINITION"
            description="1=CORSETED → 5=BOXY"
            name="waist_definition"
            value={scores.waist_definition}
            onChange={(v) => setScores((s) => ({ ...s, waist_definition: v }))}
          />
          <ScoreInput
            label="LEG OPENING"
            description="1=NARROW → 5=FLARED"
            name="leg_opening"
            value={scores.leg_opening}
            onChange={(v) => setScores((s) => ({ ...s, leg_opening: v }))}
          />
        </div>
      </div>

      {/* SURFACE & COLOUR */}
      <div className={sectionClass}>
        <p className={sectionHeadingClass}>SURFACE & COLOUR</p>
        <div className="grid grid-cols-2 gap-x-8">
          <ScoreInput
            label="SURFACE"
            description="1=CLEAN/FLAT → 5=HIGHLY PATTERNED"
            name="surface"
            value={scores.surface}
            onChange={(v) => setScores((s) => ({ ...s, surface: v }))}
          />
          <ScoreInput
            label="COLOUR DEPTH"
            description="1=PURE NEUTRAL → 5=BOLD/BRIGHT"
            name="colour_depth"
            value={scores.colour_depth}
            onChange={(v) => setScores((s) => ({ ...s, colour_depth: v }))}
          />
          <ScoreInput
            label="PATTERN"
            description="1=NONE → 5=STATEMENT PATTERN"
            name="pattern"
            value={scores.pattern}
            onChange={(v) => setScores((s) => ({ ...s, pattern: v }))}
          />
          <ScoreInput
            label="SHEEN"
            description="1=MATTE → 5=HIGH SHINE"
            name="sheen"
            value={scores.sheen}
            onChange={(v) => setScores((s) => ({ ...s, sheen: v }))}
          />
        </div>
        <div className="grid grid-cols-2 gap-4 mt-2">
          <div>
            <label className={labelClass}>COLOUR HEX</label>
            <div className="flex items-center gap-3">
              <input
                name="colour_hex"
                type="text"
                placeholder="#000000"
                defaultValue={item?.colour_hex || ''}
                className={inputClass}
                maxLength={7}
              />
              {item?.colour_hex && (
                <div
                  className="w-8 h-8 border border-[#E2E0DB] shrink-0 rounded-[2px]"
                  style={{ backgroundColor: item.colour_hex }}
                />
              )}
            </div>
          </div>
          <div>
            <label className={labelClass}>COLOUR FAMILY</label>
            <select
              name="colour_family"
              defaultValue={item?.colour_family || ''}
              className={inputClass}
            >
              <option value="">SELECT FAMILY</option>
              {COLOUR_FAMILIES.map((f) => (
                <option key={f} value={f}>
                  {f.replace(/_/g, ' ').toUpperCase()}
                </option>
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
              defaultValue={item?.material_category || ''}
              className={inputClass}
            >
              <option value="">SELECT CATEGORY</option>
              {MATERIAL_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c.replace(/_/g, ' ').toUpperCase()}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>MATERIAL PRIMARY</label>
            <input
              name="material_primary"
              type="text"
              defaultValue={item?.material_primary || ''}
              placeholder="E.G. 100% SILK"
              className={inputClass}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-8">
          <ScoreInput
            label="MATERIAL WEIGHT"
            description="1=SHEER → 5=STRUCTURAL"
            name="material_weight"
            value={scores.material_weight}
            onChange={(v) => setScores((s) => ({ ...s, material_weight: v }))}
          />
          <ScoreInput
            label="MATERIAL FORMALITY"
            description="1=CASUAL → 5=OCCASION"
            name="material_formality"
            value={scores.material_formality}
            onChange={(v) => setScores((s) => ({ ...s, material_formality: v }))}
          />
        </div>
      </div>

      {/* JEWELLERY — only if jewellery item type */}
      {isJewellery && (
        <div className={sectionClass}>
          <p className={sectionHeadingClass}>JEWELLERY</p>
          <div className="grid grid-cols-2 gap-x-8">
            <ScoreInput
              label="JEWELLERY SCALE"
              description="1=MICRO → 5=SCULPTURAL"
              name="jewellery_scale"
              value={scores.jewellery_scale}
              onChange={(v) => setScores((s) => ({ ...s, jewellery_scale: v }))}
            />
            <ScoreInput
              label="JEWELLERY FORMALITY"
              description="1=EVERYDAY → 5=HAUTE JOAILLERIE"
              name="jewellery_formality"
              value={scores.jewellery_formality}
              onChange={(v) => setScores((s) => ({ ...s, jewellery_formality: v }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className={labelClass}>JEWELLERY FINISH</label>
              <select
                name="jewellery_finish"
                defaultValue={item?.jewellery_finish || ''}
                className={inputClass}
              >
                <option value="">SELECT FINISH</option>
                {JEWELLERY_FINISHES.map((f) => (
                  <option key={f} value={f}>
                    {f.replace(/_/g, ' ').toUpperCase()}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>JEWELLERY STYLE</label>
              <select
                name="jewellery_style"
                defaultValue={item?.jewellery_style || ''}
                className={inputClass}
              >
                <option value="">SELECT STYLE</option>
                {JEWELLERY_STYLES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, ' ').toUpperCase()}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="mb-4">
            <label className={labelClass}>JEWELLERY MATERIAL PRIMARY</label>
            <input
              name="jewellery_material_primary"
              type="text"
              defaultValue={item?.jewellery_material_primary || ''}
              className={inputClass}
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              name="jewellery_layering"
              defaultChecked={item?.jewellery_layering || false}
              className="w-4 h-4 accent-[#0A0A0A]"
            />
            <span className="text-[10px] tracking-[0.20em] text-[#6B6B6B]">LAYERING PIECE</span>
          </div>
        </div>
      )}

      {/* NOTES */}
      <div className={sectionClass}>
        <p className={sectionHeadingClass}>NOTES</p>
        <div className="mb-4">
          <label className={labelClass}>ADMIN NOTES</label>
          <textarea
            name="admin_notes"
            rows={3}
            defaultValue={item?.admin_notes || ''}
            className={`${inputClass} resize-none`}
          />
        </div>
        <div>
          <label className={labelClass}>NOTES</label>
          <textarea
            name="notes"
            rows={3}
            defaultValue={item?.notes || ''}
            className={`${inputClass} resize-none`}
          />
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
