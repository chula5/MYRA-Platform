'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import type { OutfitWithItems } from '@/types/database'
import ScoreInput from '@/components/admin/ScoreInput'
import StatusBadge from '@/components/admin/StatusBadge'
import { analyseOutfit, type OutfitAnalysis, type DetectedItem } from '@/app/admin/ai/analyse-outfit'
import { scrapeProductInfo } from '@/app/admin/ai/scrape-product'
import { quickAddItemToOutfit, updateQuickItem, reorderOutfitItems } from '@/app/admin/projects/actions'
import { addOutfitToLookbook, removeOutfitFromLookbook } from '@/app/admin/lookbooks/actions'
import type { Lookbook } from '@/types/database'

const inputClass =
  'w-full border border-[#E2E0DB] bg-white px-4 py-2.5 text-[12px] tracking-[0.10em] text-[#0A0A0A] focus:outline-none focus:border-[#0A0A0A] transition-colors duration-300'
const labelClass = 'text-[10px] tracking-[0.20em] text-[#6B6B6B] mb-1.5 block'
const sectionHeadingClass =
  'text-[10px] tracking-[0.25em] text-[#6B6B6B] mb-6 pb-3 border-b border-[#E2E0DB]'
const sectionClass = 'mb-10'

const SLOTS = ['outerwear', 'top', 'bottom', 'dress', 'shoe', 'bag', 'jewellery', 'accessory'] as const

const SLOT_TYPES: Record<string, string[]> = {
  outerwear: ['coat', 'trench', 'jacket', 'blazer', 'gilet', 'cape'],
  top: ['shirt', 'blouse', 't-shirt', 'knitwear', 'corset', 'bodysuit'],
  bottom: ['trousers', 'jeans', 'shorts', 'skirt'],
  dress: ['mini_dress', 'midi_dress', 'maxi_dress', 'shirt_dress', 'slip_dress'],
  shoe: ['boot', 'heel', 'flat', 'sneaker', 'mule', 'sandal'],
  bag: ['tote', 'shoulder_bag', 'clutch', 'crossbody', 'structured_bag'],
  jewellery: ['necklace', 'earrings', 'bracelet', 'ring', 'brooch'],
  accessory: ['belt', 'scarf', 'hat', 'gloves', 'sunglasses', 'hair_accessory'],
}

interface OutfitBuilderProps {
  outfit?: OutfitWithItems
  projectId: string
  createAction: (projectId: string, formData: FormData) => Promise<{ outfitId?: string; error?: string }>
  updateAction: (outfitId: string, formData: FormData) => Promise<{ error?: string }>
  removeItemAction: (outfitItemId: string, outfitId: string) => Promise<{ error?: string }>
  lookbooks?: Lookbook[]
  outfitLookbookIds?: string[]
}

export default function OutfitBuilder({
  outfit,
  projectId,
  createAction,
  updateAction,
  removeItemAction,
  lookbooks = [],
  outfitLookbookIds = [],
}: OutfitBuilderProps) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const [tags, setTags] = useState<string[]>(outfit?.occasion_tags ?? [])
  const [imageUrl, setImageUrl] = useState(outfit?.image_url ?? '')
  const [aestheticLabel, setAestheticLabel] = useState(outfit?.aesthetic_label ?? '')
  const [celebrityName, setCelebrityName] = useState((outfit as any)?.celebrity_name ?? '')

  // AI state
  const [analysing, setAnalysing] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [detectedItems, setDetectedItems] = useState<DetectedItem[]>([])
  const [itemInputs, setItemInputs] = useState<Record<number, { itemType: string; productName: string; brandName: string; imageUrl: string; retailerUrl: string; adding: boolean; added: boolean; error: string | null }>>({})

  const [scores, setScores] = useState<Partial<OutfitAnalysis>>({
    formality: outfit?.formality ?? 3,
    planning: outfit?.planning ?? 3,
    wearer_priority: outfit?.wearer_priority ?? 3,
    time_of_day: outfit?.time_of_day ?? 3,
    construction: outfit?.construction ?? 3,
    surface_story: outfit?.surface_story ?? 3,
    volume: outfit?.volume ?? 3,
    colour_story: outfit?.colour_story ?? 3,
    intent: outfit?.intent ?? 3,
    outerwear_construction: outfit?.outerwear_construction ?? null,
    outerwear_volume: outfit?.outerwear_volume ?? null,
    outerwear_material_weight: outfit?.outerwear_material_weight ?? null,
    outerwear_material_formality: outfit?.outerwear_material_formality ?? null,
    top_construction: outfit?.top_construction ?? null,
    top_volume: outfit?.top_volume ?? null,
    top_material_weight: outfit?.top_material_weight ?? null,
    top_material_formality: outfit?.top_material_formality ?? null,
    bottom_construction: outfit?.bottom_construction ?? null,
    bottom_volume: outfit?.bottom_volume ?? null,
    bottom_rise: outfit?.bottom_rise ?? null,
    bottom_leg_opening: outfit?.bottom_leg_opening ?? null,
    bottom_material_weight: outfit?.bottom_material_weight ?? null,
    dress_construction: (outfit as any)?.dress_construction ?? null,
    dress_volume: (outfit as any)?.dress_volume ?? null,
    dress_length: (outfit as any)?.dress_length ?? null,
    dress_material_weight: (outfit as any)?.dress_material_weight ?? null,
    dress_material_formality: (outfit as any)?.dress_material_formality ?? null,
    shoe_formality: outfit?.shoe_formality ?? null,
    shoe_style: outfit?.shoe_style ?? null,
    bag_formality: outfit?.bag_formality ?? null,
    jewellery_scale: outfit?.jewellery_scale ?? null,
    jewellery_formality: outfit?.jewellery_formality ?? null,
  })

  // Edit state for existing outfit items
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [editFields, setEditFields] = useState<Record<string, string>>({})
  const [savingEdit, setSavingEdit] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // Ordered items (local state — sorted by sort_order, falling back to DB order)
  type OI = NonNullable<OutfitWithItems['outfit_item']>[number]
  const sortedSource = [...(outfit?.outfit_item ?? [])].sort(
    (a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999)
  )
  const [orderedItems, setOrderedItems] = useState<OI[]>(sortedSource)
  const [savingOrder, setSavingOrder] = useState(false)
  const [orderError, setOrderError] = useState<string | null>(null)

  // Keep orderedItems in sync when outfit prop changes (e.g. after add/remove)
  useEffect(() => {
    const sorted = [...(outfit?.outfit_item ?? [])].sort(
      (a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999)
    )
    setOrderedItems(sorted)
  }, [outfit?.outfit_item])

  // When outfit items change (e.g. after delete), reset detected item cards whose slot is no longer filled
  useEffect(() => {
    if (detectedItems.length === 0) return
    const filledSlots = new Set((outfit?.outfit_item ?? []).map((oi) => oi.slot))
    setItemInputs((prev) => {
      const next = { ...prev }
      detectedItems.forEach((detected, i) => {
        if (next[i]?.added && !filledSlots.has(detected.slot as string)) {
          next[i] = { ...next[i], added: false }
        }
      })
      return next
    })
  }, [outfit?.outfit_item, detectedItems])

  function startEdit(oi: { outfit_item_id: string; item?: { item_id: string; product_name: string; image_url: string; retailer_url: string; brand?: { name: string } | null } | null }) {
    setEditingItemId(oi.outfit_item_id)
    setEditError(null)
    setEditFields({
      productName: oi.item?.product_name ?? '',
      brandName: oi.item?.brand?.name ?? '',
      imageUrl: oi.item?.image_url ?? '',
      retailerUrl: oi.item?.retailer_url ?? '',
    })
  }

  async function handleSaveEdit(outfitItemId: string, itemId: string) {
    if (!outfit) return
    setSavingEdit(true)
    setEditError(null)
    const result = await updateQuickItem(
      itemId,
      outfit.outfit_id,
      editFields.productName,
      editFields.brandName,
      editFields.imageUrl,
      editFields.retailerUrl
    )
    setSavingEdit(false)
    if (result.error) { setEditError(result.error); return }
    setEditingItemId(null)
    router.refresh()
  }

  function moveItem(index: number, dir: -1 | 1) {
    const next = [...orderedItems]
    const swap = index + dir
    if (swap < 0 || swap >= next.length) return
    ;[next[index], next[swap]] = [next[swap], next[index]]
    setOrderedItems(next)
  }

  async function handleSaveOrder() {
    if (!outfit) return
    setSavingOrder(true)
    setOrderError(null)
    const result = await reorderOutfitItems(outfit.outfit_id, orderedItems.map((i) => i.outfit_item_id))
    setSavingOrder(false)
    if (result.error) { setOrderError(result.error); return }
    router.refresh()
  }

  // Manual quick-add form state
  const [manualSlot, setManualSlot] = useState<string>('top')
  const [manualItemType, setManualItemType] = useState<string>((SLOT_TYPES['top'] ?? ['shirt'])[0])
  const [manualProductName, setManualProductName] = useState('')
  const [manualBrandName, setManualBrandName] = useState('')
  const [manualImageUrl, setManualImageUrl] = useState('')
  const [manualRetailerUrl, setManualRetailerUrl] = useState('')
  const [manualAdding, setManualAdding] = useState(false)
  const [manualError, setManualError] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)

  // Lookbook state
  const [checkedLookbooks, setCheckedLookbooks] = useState<Set<string>>(new Set(outfitLookbookIds))
  const [lookbookLoading, setLookbookLoading] = useState<Set<string>>(new Set())
  const [lookbookError, setLookbookError] = useState<string | null>(null)

  function handleTagKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      const val = tagInput.trim()
      if (val && !tags.includes(val)) {
        setTags((prev) => [...prev, val])
      }
      setTagInput('')
    }
  }

  function removeTag(tag: string) {
    setTags((prev) => prev.filter((t) => t !== tag))
  }

  async function handleAnalyse() {
    if (!imageUrl) return
    setAnalysing(true)
    setAiError(null)
    const result = await analyseOutfit(imageUrl)
    setAnalysing(false)
    if (result.error) {
      setAiError(result.error)
      return
    }
    if (result.data) {
      const d = result.data
      setAestheticLabel(d.aesthetic_label)
      setTags(d.occasion_tags)
      setScores(d)
      const items = d.detected_items ?? []
      setDetectedItems(items)
      const inputs: typeof itemInputs = {}
      items.forEach((_, i) => {
        const defaultType = (SLOT_TYPES[items[i].slot] ?? ['coat'])[0]
      inputs[i] = { itemType: defaultType, productName: '', brandName: '', imageUrl: '', retailerUrl: '', adding: false, added: false, error: null }
      })
      setItemInputs(inputs)
    }
  }

  function updateItemInput(index: number, field: string, value: string) {
    setItemInputs((prev) => ({ ...prev, [index]: { ...prev[index], [field]: value } }))
  }

  async function handleRetailerUrlBlur(index: number, url: string) {
    if (!url || !url.startsWith('http')) return
    const inp = itemInputs[index]
    // Only auto-fill if fields are still empty
    if (inp?.productName && inp?.brandName) return
    setItemInputs((prev) => ({ ...prev, [index]: { ...prev[index], scraping: true } }))
    const result = await scrapeProductInfo(url)
    setItemInputs((prev) => {
      const cur = prev[index]
      return {
        ...prev,
        [index]: {
          ...cur,
          scraping: false,
          productName: cur?.productName || result.data?.productName || cur?.productName || '',
          brandName: cur?.brandName || result.data?.brandName || cur?.brandName || '',
        },
      }
    })
  }

  async function handleQuickAdd(index: number) {
    if (!outfit) return
    const input = itemInputs[index]
    const detected = detectedItems[index]
    setItemInputs((prev) => ({ ...prev, [index]: { ...prev[index], adding: true, error: null } }))
    console.log('[handleQuickAdd] input:', input)
    const result = await quickAddItemToOutfit(
      outfit.outfit_id,
      detected.slot,
      input.itemType,
      input.productName,
      input.brandName,
      input.imageUrl,
      input.retailerUrl
    )
    if (result.error) {
      setItemInputs((prev) => ({ ...prev, [index]: { ...prev[index], adding: false, error: result.error! } }))
      return
    }
    setItemInputs((prev) => ({ ...prev, [index]: { ...prev[index], adding: false, added: true } }))
    router.refresh()
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    const formData = new FormData(e.currentTarget)
    // Inject controlled state
    formData.set('occasion_tags', tags.join(','))
    formData.set('aesthetic_label', aestheticLabel)
    formData.set('celebrity_name', celebrityName)

    let result: { error?: string; outfitId?: string }
    if (outfit) {
      result = await updateAction(outfit.outfit_id, formData)
    } else {
      result = await createAction(projectId, formData)
    }
    setSubmitting(false)

    if (result?.error) {
      setError(result.error)
      return
    }

    if (!outfit && result.outfitId) {
      router.push(`/admin/projects/${projectId}/outfits/${result.outfitId}/edit`)
      return
    }
    router.refresh()
  }

  async function handleManualAdd() {
    if (!outfit) return
    setManualAdding(true)
    setManualError(null)
    const result = await quickAddItemToOutfit(
      outfit.outfit_id,
      manualSlot,
      manualItemType,
      manualProductName,
      manualBrandName,
      manualImageUrl,
      manualRetailerUrl,
    )
    setManualAdding(false)
    if (result.error) { setManualError(result.error); return }
    setManualProductName('')
    setManualBrandName('')
    setManualImageUrl('')
    setManualRetailerUrl('')
    router.refresh()
  }

  async function handleRemoveItem(outfitItemId: string) {
    if (!outfit) return
    setRemovingId(outfitItemId)
    await removeItemAction(outfitItemId, outfit.outfit_id)
    setRemovingId(null)
    router.refresh()
  }

  async function handleToggleLookbook(lookbookId: string) {
    if (!outfit) return
    setLookbookLoading((prev) => new Set([...prev, lookbookId]))
    setLookbookError(null)
    const isChecked = checkedLookbooks.has(lookbookId)
    const result = isChecked
      ? await removeOutfitFromLookbook(outfit.outfit_id, lookbookId)
      : await addOutfitToLookbook(outfit.outfit_id, lookbookId)
    setLookbookLoading((prev) => { const n = new Set(prev); n.delete(lookbookId); return n })
    if (result.error) { setLookbookError(result.error); return }
    setCheckedLookbooks((prev) => {
      const n = new Set(prev)
      isChecked ? n.delete(lookbookId) : n.add(lookbookId)
      return n
    })
  }

  return (
    <div className="grid grid-cols-[1fr_360px] gap-10">
      {/* Main form */}
      <form onSubmit={handleSubmit}>
        {/* IMAGE & IDENTITY */}
        <div className={sectionClass}>
          <p className={sectionHeadingClass}>IMAGE & IDENTITY</p>
          <div className="mb-4">
            <label className={labelClass}>IMAGE URL</label>
            <div className="flex gap-3 items-start">
              <div className="flex-1">
                <input
                  name="image_url"
                  type="url"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  className={inputClass}
                />
                {imageUrl && (
                  <button
                    type="button"
                    onClick={handleAnalyse}
                    disabled={analysing}
                    className="mt-2 bg-[#0A0A0A] text-white px-5 py-2 text-[10px] tracking-[0.20em] transition-colors duration-300 hover:bg-[#333] disabled:opacity-50"
                  >
                    {analysing ? 'ANALYSING...' : 'ANALYSE WITH AI →'}
                  </button>
                )}
                {aiError && (
                  <p className="mt-2 text-[9px] tracking-[0.12em] text-red-500">{aiError}</p>
                )}
              </div>
            </div>
          </div>
          <div className="mb-4">
            <label className={labelClass}>AESTHETIC LABEL</label>
            <input
              name="aesthetic_label"
              type="text"
              value={aestheticLabel}
              onChange={(e) => setAestheticLabel(e.target.value)}
              className={inputClass}
              required
            />
          </div>
          <div className="mb-4">
            <label className={labelClass}>CELEBRITY NAME</label>
            <input
              name="celebrity_name"
              type="text"
              value={celebrityName}
              onChange={(e) => setCelebrityName(e.target.value)}
              placeholder="E.G. EMILY RATAJKOWSKI"
              className={inputClass}
            />
          </div>
          <div className="mb-4">
            <label className={labelClass}>OCCASION TAGS</label>
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={handleTagKeyDown}
              placeholder="TYPE TAG AND PRESS ENTER OR COMMA"
              className={inputClass}
            />
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1.5 bg-[#F2F2F0] border border-[#E2E0DB] px-2.5 py-1 text-[9px] tracking-[0.15em] text-[#6B6B6B]"
                  >
                    {tag.toUpperCase()}
                    <button
                      type="button"
                      onClick={() => removeTag(tag)}
                      className="text-[#A8A8A4] hover:text-[#0A0A0A] transition-colors"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="mb-4">
            <label className={labelClass}>STATUS</label>
            <select
              name="status"
              defaultValue={outfit?.status || 'draft'}
              className={inputClass}
            >
              <option value="draft">DRAFT</option>
              <option value="in_review">IN REVIEW</option>
              <option value="live">LIVE</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>ADMIN NOTES</label>
            <textarea
              name="admin_notes"
              rows={3}
              defaultValue={outfit?.admin_notes || ''}
              className={`${inputClass} resize-none`}
            />
          </div>
        </div>

        {/* OCCASION SCORING */}
        <div className={sectionClass}>
          <p className={sectionHeadingClass}>OCCASION SCORING</p>
          <div className="grid grid-cols-2 gap-x-8">
            <ScoreInput label="FORMALITY" description="1=CASUAL → 5=BLACK TIE" name="formality" value={scores.formality ?? 3} required />
            <ScoreInput label="PLANNING" description="1=SPONTANEOUS → 5=DESTINATION" name="planning" value={scores.planning ?? 3} required />
            <ScoreInput label="WEARER PRIORITY" description="1=MAX COMFORT → 5=SACRIFICIAL IMPACT" name="wearer_priority" value={scores.wearer_priority ?? 3} required />
            <ScoreInput label="TIME OF DAY" description="1=DAY → 5=NIGHT" name="time_of_day" value={scores.time_of_day ?? 3} required />
          </div>
        </div>

        {/* OUTFIT SCORING */}
        <div className={sectionClass}>
          <p className={sectionHeadingClass}>OUTFIT SCORING</p>
          <div className="grid grid-cols-2 gap-x-8">
            <ScoreInput label="CONSTRUCTION" description="1=TAILORED → 5=RELAXED" name="construction" value={scores.construction ?? 3} required />
            <ScoreInput label="SURFACE STORY" description="1=CLEAN → 5=HIGHLY PATTERNED" name="surface_story" value={scores.surface_story ?? 3} required />
            <ScoreInput label="VOLUME" description="1=FITTED → 5=OVERSIZED" name="volume" value={scores.volume ?? 3} required />
            <ScoreInput label="COLOUR STORY" description="1=PURE NEUTRAL → 5=BOLD COLOUR" name="colour_story" value={scores.colour_story ?? 3} required />
            <ScoreInput label="INTENT" description="1=BACKGROUND → 5=DOMINANT FOCAL" name="intent" value={scores.intent ?? 3} required />
          </div>
        </div>

        {/* SLOT SCORING */}
        <div className={sectionClass}>
          <p className={sectionHeadingClass}>SLOT SCORING</p>

          <p className="text-[9px] tracking-[0.20em] text-[#A8A8A4] mb-3">OUTERWEAR</p>
          <div className="grid grid-cols-2 gap-x-8 mb-6">
            <ScoreInput label="CONSTRUCTION" description="1=TAILORED → 5=RELAXED" name="outerwear_construction" value={scores.outerwear_construction ?? null} />
            <ScoreInput label="VOLUME" description="1=FITTED → 5=OVERSIZED" name="outerwear_volume" value={scores.outerwear_volume ?? null} />
            <ScoreInput label="MATERIAL WEIGHT" description="1=SHEER → 5=STRUCTURAL" name="outerwear_material_weight" value={scores.outerwear_material_weight ?? null} />
            <ScoreInput label="MATERIAL FORMALITY" description="1=CASUAL → 5=OCCASION" name="outerwear_material_formality" value={scores.outerwear_material_formality ?? null} />
          </div>

          <p className="text-[9px] tracking-[0.20em] text-[#A8A8A4] mb-3">TOP</p>
          <div className="grid grid-cols-2 gap-x-8 mb-6">
            <ScoreInput label="CONSTRUCTION" description="1=TAILORED → 5=RELAXED" name="top_construction" value={scores.top_construction ?? null} />
            <ScoreInput label="VOLUME" description="1=FITTED → 5=OVERSIZED" name="top_volume" value={scores.top_volume ?? null} />
            <ScoreInput label="MATERIAL WEIGHT" description="1=SHEER → 5=STRUCTURAL" name="top_material_weight" value={scores.top_material_weight ?? null} />
            <ScoreInput label="MATERIAL FORMALITY" description="1=CASUAL → 5=OCCASION" name="top_material_formality" value={scores.top_material_formality ?? null} />
          </div>

          <p className="text-[9px] tracking-[0.20em] text-[#A8A8A4] mb-3">DRESS</p>
          <div className="grid grid-cols-2 gap-x-8 mb-6">
            <ScoreInput label="CONSTRUCTION" description="1=TAILORED → 5=RELAXED" name="dress_construction" value={(scores as any).dress_construction ?? null} />
            <ScoreInput label="VOLUME" description="1=FITTED → 5=OVERSIZED" name="dress_volume" value={(scores as any).dress_volume ?? null} />
            <ScoreInput label="LENGTH" description="1=MICRO/MINI → 5=MAXI/FLOOR" name="dress_length" value={(scores as any).dress_length ?? null} />
            <ScoreInput label="MATERIAL WEIGHT" description="1=SHEER → 5=STRUCTURAL" name="dress_material_weight" value={(scores as any).dress_material_weight ?? null} />
            <ScoreInput label="MATERIAL FORMALITY" description="1=CASUAL → 5=OCCASION" name="dress_material_formality" value={(scores as any).dress_material_formality ?? null} />
          </div>

          <p className="text-[9px] tracking-[0.20em] text-[#A8A8A4] mb-3">BOTTOM</p>
          <div className="grid grid-cols-2 gap-x-8 mb-6">
            <ScoreInput label="CONSTRUCTION" description="1=TAILORED → 5=RELAXED" name="bottom_construction" value={scores.bottom_construction ?? null} />
            <ScoreInput label="VOLUME" description="1=FITTED → 5=OVERSIZED" name="bottom_volume" value={scores.bottom_volume ?? null} />
            <ScoreInput label="RISE" description="1=ULTRA LOW → 5=ULTRA HIGH" name="bottom_rise" value={scores.bottom_rise ?? null} />
            <ScoreInput label="LEG OPENING" description="1=NARROW → 5=FLARED" name="bottom_leg_opening" value={scores.bottom_leg_opening ?? null} />
            <ScoreInput label="MATERIAL WEIGHT" description="1=SHEER → 5=STRUCTURAL" name="bottom_material_weight" value={scores.bottom_material_weight ?? null} />
          </div>

          <p className="text-[9px] tracking-[0.20em] text-[#A8A8A4] mb-3">SHOE</p>
          <div className="grid grid-cols-2 gap-x-8 mb-6">
            <ScoreInput label="FORMALITY" description="1=CASUAL → 5=OCCASION" name="shoe_formality" value={scores.shoe_formality ?? null} />
            <ScoreInput label="STYLE" description="1=FLAT/CASUAL → 5=HEEL/STATEMENT" name="shoe_style" value={scores.shoe_style ?? null} />
          </div>

          <p className="text-[9px] tracking-[0.20em] text-[#A8A8A4] mb-3">BAG</p>
          <div className="grid grid-cols-2 gap-x-8 mb-6">
            <ScoreInput label="FORMALITY" description="1=CASUAL → 5=OCCASION" name="bag_formality" value={scores.bag_formality ?? null} />
          </div>

          <p className="text-[9px] tracking-[0.20em] text-[#A8A8A4] mb-3">JEWELLERY</p>
          <div className="grid grid-cols-2 gap-x-8 mb-6">
            <ScoreInput label="SCALE" description="1=MICRO → 5=SCULPTURAL" name="jewellery_scale" value={scores.jewellery_scale ?? null} />
            <ScoreInput label="FORMALITY" description="1=EVERYDAY → 5=HAUTE JOAILLERIE" name="jewellery_formality" value={scores.jewellery_formality ?? null} />
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
          {submitting ? 'SAVING...' : 'SAVE OUTFIT'}
        </button>
      </form>

      {/* Right panel — Items */}
      <div>
        <div className="sticky top-6">
          {/* Large outfit image preview */}
          {imageUrl && (
            <div className="mb-6">
              <img
                src={imageUrl}
                alt="Outfit preview"
                className="w-full object-contain border border-[#E2E0DB] max-h-[520px]"
              />
            </div>
          )}
          <div className={sectionClass}>
            {detectedItems.length > 0 && (
            <div className="mb-8">
              <p className={sectionHeadingClass}>AI DETECTED ITEMS</p>
              <div className="space-y-4">
                {detectedItems.map((item, i) => {
                  const inp = itemInputs[i] ?? { productName: '', brandName: '', imageUrl: '', retailerUrl: '', adding: false, added: false, error: null }
                  return (
                    <div key={i} className={`border p-4 ${inp.added ? 'border-[#0A0A0A] bg-[#F8F8F6] opacity-60' : 'border-[#E2E0DB] bg-white'}`}>
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-[9px] tracking-[0.20em] text-[#A8A8A4]">{item.slot.toUpperCase()}</span>
                        {inp.added && <span className="text-[9px] tracking-[0.15em] text-[#0A0A0A]">ADDED ✓</span>}
                      </div>
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <p className="text-[10px] tracking-[0.10em] text-[#6B6B6B] italic flex-1">{item.description}</p>
                        <a
                          href={`https://www.google.com/search?q=${encodeURIComponent(item.description)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 border border-[#E2E0DB] px-2.5 py-1 text-[9px] tracking-[0.15em] text-[#6B6B6B] hover:border-[#0A0A0A] hover:text-[#0A0A0A] transition-colors duration-300 whitespace-nowrap"
                        >
                          SEARCH →
                        </a>
                      </div>
                      {!inp.added && (
                        <>
                          <div className="space-y-2 mb-3">
                            <select
                              defaultValue={(SLOT_TYPES[item.slot] ?? ['coat'])[0]}
                              onChange={(e) => updateItemInput(i, 'itemType', e.target.value)}
                              className={inputClass}
                            >
                              {(SLOT_TYPES[item.slot] ?? []).map((t) => (
                                <option key={t} value={t}>{t.replace(/_/g, ' ').toUpperCase()}</option>
                              ))}
                            </select>
                            <input
                              type="text"
                              placeholder="PRODUCT NAME"
                              value={inp.productName}
                              onChange={(e) => updateItemInput(i, 'productName', e.target.value)}
                              className={inputClass}
                            />
                            <input
                              type="text"
                              placeholder="BRAND NAME"
                              value={inp.brandName}
                              onChange={(e) => updateItemInput(i, 'brandName', e.target.value)}
                              className={inputClass}
                            />
                            <input
                              type="url"
                              placeholder="IMAGE URL"
                              value={inp.imageUrl}
                              onChange={(e) => updateItemInput(i, 'imageUrl', e.target.value)}
                              className={inputClass}
                            />
                            <div className="relative">
                              <input
                                type="url"
                                placeholder="RETAILER / SHOP URL"
                                value={inp.retailerUrl}
                                onChange={(e) => updateItemInput(i, 'retailerUrl', e.target.value)}
                                onBlur={(e) => handleRetailerUrlBlur(i, e.target.value)}
                                className={inputClass}
                              />
                              {(inp as any).scraping && (
                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] tracking-[0.12em] text-[#A8A8A4]">
                                  FETCHING...
                                </span>
                              )}
                            </div>
                          </div>
                          {inp.error && (
                            <p className="text-[9px] tracking-[0.12em] text-red-500 mb-2">{inp.error}</p>
                          )}
                          {!outfit ? (
                            <p className="text-[9px] tracking-[0.12em] text-[#A8A8A4]">SAVE OUTFIT FIRST TO ADD ITEMS.</p>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleQuickAdd(i)}
                              disabled={inp.adding}
                              className="w-full bg-[#0A0A0A] text-white py-2 text-[10px] tracking-[0.20em] transition-colors duration-300 hover:bg-[#333] disabled:opacity-40"
                            >
                              {inp.adding ? 'ADDING...' : 'ADD ITEM →'}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <p className={sectionHeadingClass}>ITEMS IN THIS OUTFIT</p>
            {!outfit ? (
              <p className="text-[10px] tracking-[0.15em] text-[#A8A8A4]">
                SAVE THE OUTFIT FIRST TO ADD ITEMS.
              </p>
            ) : (
              <>
                {/* Current items */}
                {orderedItems.length > 0 ? (
                  <div className="mb-6">
                    <div className="space-y-3 mb-3">
                      {orderedItems.map((oi, idx) => (
                        <div key={oi.outfit_item_id} className="border border-[#E2E0DB] bg-white">
                          {editingItemId === oi.outfit_item_id ? (
                            <div className="p-3">
                              <div className="flex items-center justify-between mb-3">
                                <StatusBadge status={oi.slot} />
                                <button type="button" onClick={() => setEditingItemId(null)} className="text-[9px] tracking-[0.15em] text-[#A8A8A4] hover:text-[#0A0A0A]">CANCEL</button>
                              </div>
                              <div className="space-y-2">
                                <input type="text" placeholder="PRODUCT NAME" value={editFields.productName} onChange={(e) => setEditFields((p) => ({ ...p, productName: e.target.value }))} className={inputClass} />
                                <input type="text" placeholder="BRAND NAME" value={editFields.brandName} onChange={(e) => setEditFields((p) => ({ ...p, brandName: e.target.value }))} className={inputClass} />
                                <input type="url" placeholder="IMAGE URL" value={editFields.imageUrl} onChange={(e) => setEditFields((p) => ({ ...p, imageUrl: e.target.value }))} className={inputClass} />
                                <input type="url" placeholder="RETAILER URL" value={editFields.retailerUrl} onChange={(e) => setEditFields((p) => ({ ...p, retailerUrl: e.target.value }))} className={inputClass} />
                              </div>
                              {editError && <p className="mt-2 text-[9px] tracking-[0.12em] text-red-500">{editError}</p>}
                              <button
                                type="button"
                                onClick={() => handleSaveEdit(oi.outfit_item_id, oi.item?.item_id ?? '')}
                                disabled={savingEdit}
                                className="mt-3 w-full bg-[#0A0A0A] text-white py-2 text-[10px] tracking-[0.20em] hover:bg-[#333] disabled:opacity-40"
                              >
                                {savingEdit ? 'SAVING...' : 'SAVE CHANGES'}
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 p-3">
                              {/* Up/down controls */}
                              <div className="flex flex-col gap-0.5 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => moveItem(idx, -1)}
                                  disabled={idx === 0}
                                  className="w-5 h-5 flex items-center justify-center text-[#A8A8A4] hover:text-[#0A0A0A] disabled:opacity-20 transition-colors text-[10px]"
                                >
                                  ▲
                                </button>
                                <button
                                  type="button"
                                  onClick={() => moveItem(idx, 1)}
                                  disabled={idx === orderedItems.length - 1}
                                  className="w-5 h-5 flex items-center justify-center text-[#A8A8A4] hover:text-[#0A0A0A] disabled:opacity-20 transition-colors text-[10px]"
                                >
                                  ▼
                                </button>
                              </div>
                              {oi.item?.image_url ? (
                                <img
                                  src={oi.item.image_url}
                                  alt={oi.item.product_name}
                                  className="w-[64px] h-[80px] object-cover border border-[#E2E0DB] shrink-0 bg-white"
                                />
                              ) : (
                                <div className="w-[64px] h-[80px] bg-[#F2F2F0] border border-[#E2E0DB] shrink-0 flex items-center justify-center">
                                  <span className="text-[8px] tracking-[0.10em] text-[#A8A8A4]">NO IMG</span>
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="text-[9px] tracking-[0.15em] text-[#A8A8A4] mb-0.5">{oi.item?.brand?.name?.toUpperCase()}</p>
                                <p className="text-[10px] tracking-[0.12em] text-[#0A0A0A] truncate">{oi.item?.product_name?.toUpperCase()}</p>
                                <StatusBadge status={oi.slot} />
                              </div>
                              <div className="flex flex-col items-end gap-1.5 shrink-0">
                                <button type="button" onClick={() => startEdit(oi)} className="text-[9px] tracking-[0.15em] text-[#6B6B6B] hover:text-[#0A0A0A] transition-colors">EDIT</button>
                                <button type="button" onClick={() => handleRemoveItem(oi.outfit_item_id)} disabled={removingId === oi.outfit_item_id} className="text-[#A8A8A4] hover:text-[#0A0A0A] transition-colors text-[16px]">×</button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    {orderedItems.length > 1 && (
                      <>
                        <button
                          type="button"
                          onClick={handleSaveOrder}
                          disabled={savingOrder}
                          className="w-full border border-[#0A0A0A] text-[#0A0A0A] py-2 text-[10px] tracking-[0.20em] hover:bg-[#0A0A0A] hover:text-white transition-colors duration-300 disabled:opacity-40"
                        >
                          {savingOrder ? 'SAVING ORDER...' : 'SAVE ORDER'}
                        </button>
                        {orderError && (
                          <p className="mt-2 text-[9px] tracking-[0.12em] text-red-500">{orderError}</p>
                        )}
                      </>
                    )}
                  </div>
                ) : (
                  <p className="text-[10px] tracking-[0.15em] text-[#A8A8A4] mb-6">
                    NO ITEMS ADDED YET.
                  </p>
                )}

                {/* Manual quick-add form */}
                <div className="border border-[#E2E0DB] bg-[#F8F8F6] p-4">
                  <p className="text-[9px] tracking-[0.20em] text-[#6B6B6B] mb-3">ADD ITEM MANUALLY</p>
                  <div className="space-y-2 mb-3">
                    <select
                      value={manualSlot}
                      onChange={(e) => {
                        setManualSlot(e.target.value)
                        setManualItemType((SLOT_TYPES[e.target.value] ?? ['coat'])[0])
                      }}
                      className={inputClass}
                    >
                      {SLOTS.map((s) => (
                        <option key={s} value={s}>{s.toUpperCase()}</option>
                      ))}
                    </select>
                    <select
                      value={manualItemType}
                      onChange={(e) => setManualItemType(e.target.value)}
                      className={inputClass}
                    >
                      {(SLOT_TYPES[manualSlot] ?? []).map((t) => (
                        <option key={t} value={t}>{t.replace(/_/g, ' ').toUpperCase()}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      placeholder="PRODUCT NAME"
                      value={manualProductName}
                      onChange={(e) => setManualProductName(e.target.value)}
                      className={inputClass}
                    />
                    <input
                      type="text"
                      placeholder="BRAND NAME"
                      value={manualBrandName}
                      onChange={(e) => setManualBrandName(e.target.value)}
                      className={inputClass}
                    />
                    <input
                      type="url"
                      placeholder="IMAGE URL"
                      value={manualImageUrl}
                      onChange={(e) => setManualImageUrl(e.target.value)}
                      className={inputClass}
                    />
                    <input
                      type="url"
                      placeholder="RETAILER / SHOP URL"
                      value={manualRetailerUrl}
                      onChange={(e) => setManualRetailerUrl(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                  {manualError && (
                    <p className="text-[9px] tracking-[0.12em] text-red-500 mb-2">{manualError}</p>
                  )}
                  <button
                    type="button"
                    onClick={handleManualAdd}
                    disabled={manualAdding}
                    className="w-full bg-[#0A0A0A] text-white py-2.5 text-[10px] tracking-[0.20em] transition-colors duration-300 hover:bg-[#333] disabled:opacity-40"
                  >
                    {manualAdding ? 'ADDING...' : 'ADD TO OUTFIT'}
                  </button>
                </div>
              </>
            )}

            {/* ── LOOKBOOKS ─────────────────────────────────────── */}
            {lookbooks.length > 0 && (
              <div className="mt-10">
                <p className={sectionHeadingClass}>LOOKBOOKS</p>
                {!outfit ? (
                  <p className="text-[10px] tracking-[0.15em] text-[#A8A8A4]">
                    SAVE THE OUTFIT FIRST TO ADD TO A LOOKBOOK.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {lookbooks.map((lb) => {
                      const checked = checkedLookbooks.has(lb.lookbook_id)
                      const loading = lookbookLoading.has(lb.lookbook_id)
                      return (
                        <button
                          key={lb.lookbook_id}
                          type="button"
                          onClick={() => handleToggleLookbook(lb.lookbook_id)}
                          disabled={loading}
                          className={`w-full flex items-center justify-between px-4 py-3 border text-left transition-colors duration-200 disabled:opacity-50 ${
                            checked
                              ? 'border-[#0A0A0A] bg-[#0A0A0A] text-white'
                              : 'border-[#E2E0DB] bg-white text-[#0A0A0A] hover:border-[#0A0A0A]'
                          }`}
                        >
                          <span className="text-[10px] tracking-[0.18em]">
                            {lb.title.toUpperCase()}
                          </span>
                          <span className="text-[12px]">
                            {loading ? '···' : checked ? '✓' : '+'}
                          </span>
                        </button>
                      )
                    })}
                    {lookbookError && (
                      <p className="text-[9px] tracking-[0.12em] text-red-500">{lookbookError}</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
