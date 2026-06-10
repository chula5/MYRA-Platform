// Shared Higgsfield "editorial shoot" config + prompt builders (from the
// myra-higgsfield-shoot skill). Framework-agnostic so it can be used both
// client-side (OutfitBuilder pose buttons) and server-side (composer auto-trigger).
//
// Only POSE B has a real pose/lighting reference image in Cloudinary; the skill's
// pose-a/c/d/e reference URLs 404, so the others drive the pose by TEXT only
// (poseRef = null) — that's what makes each pose produce a genuinely different shot.

export type HiggsfieldCombo = {
  key: string
  label: string
  sublabel: string
  combo: string
  poseRef: string | null
  pose: string
  lighting: string
  hair: string  // pose-appropriate hair STYLING (not colour — colour varies per model)
}

export const POSE_B_REF =
  'https://res.cloudinary.com/dugby2pow/image/upload/f_jpg,q_90,w_1024/v1778533850/hf_20260423_181435_8fdd30ea-92d0-4d38-9d6c-aab5d6949afd_hu6dxf.png'

export const HIGGSFIELD_COMBOS: Record<string, HiggsfieldCombo> = {
  A1: {
    key: 'A1', label: '¾ TURN', sublabel: 'Flat white',
    combo: 'Flat White Studio (LIGHT 01) + Three-Quarter Turn (POSE A)',
    poseRef: null,
    pose: 'three quarter turn, body angled 45 degrees, weight on back foot, arms relaxed, slight face turn toward camera, neutral editorial expression no smile',
    lighting: 'flat white studio lighting, clean bright background, even diffused light, no harsh shadows, high key fashion editorial',
    hair: 'worn down with soft natural movement',
  },
  B2: {
    key: 'B2', label: 'STRAIGHT ON', sublabel: 'Soft grey',
    combo: 'Soft Architectural Grey (LIGHT 02) + Straight On (POSE B)',
    poseRef: POSE_B_REF,
    pose: 'straight on facing camera, feet shoulder width apart, arms loose at sides, neutral face forward, tall and grounded, still and monumental',
    lighting: 'soft grey seamless studio, cool diffused lighting, slight directional fill, quiet luxury editorial, muted tones',
    hair: 'worn down, sleek and natural',
  },
  C3: {
    key: 'C3', label: 'SIDE PROFILE', sublabel: 'Dramatic warm',
    combo: 'Dramatic Warm Side (LIGHT 03) + Side Profile (POSE C)',
    poseRef: null,
    pose: 'pure side profile 90 degrees, head slightly bowed downward, arms at sides, hands relaxed, mysterious editorial',
    lighting: 'dramatic side lighting, warm grey background, single light source from left, deep shadow on right side, cinematic fashion editorial',
    hair: 'pulled back off the face, slicked',
  },
  D4: {
    key: 'D4', label: 'RAW ENERGY', sublabel: 'Cool grey',
    combo: 'Raw Cool Grey (LIGHT 04) + Raw Energy (POSE D)',
    poseRef: null,
    pose: 'straight on facing camera, arms loose slightly away from body, direct neutral gaze, raw editorial energy, present not absent',
    lighting: 'cool grey studio background, natural diffused lighting, slightly raw editorial, lived-in energy, not over-retouched',
    hair: 'loose and slightly undone',
  },
  E5: {
    key: 'E5', label: 'REFINED', sublabel: 'Warm tonal',
    combo: 'Warm Tonal Grey (LIGHT 05) + Refined + Accessorised (POSE E)',
    poseRef: null,
    pose: 'straight on facing camera, feet together, arms at sides hands relaxed, statement accessory, composed and architectural',
    lighting: 'warm grey studio background, even frontal lighting, subtle vignette, tonal and refined, accessories-forward editorial',
    hair: 'severely slicked back',
  },
}

export const HIGGSFIELD_POSE_OPTIONS: HiggsfieldCombo[] = [
  HIGGSFIELD_COMBOS.A1, HIGGSFIELD_COMBOS.B2, HIGGSFIELD_COMBOS.C3, HIGGSFIELD_COMBOS.D4, HIGGSFIELD_COMBOS.E5,
]

// Normalised item shape the builders work with (decoupled from DB row types).
export interface ShootItem {
  product_name?: string | null
  item_type?: string | null
  material_primary?: string | null
  slot?: string | null
  image_url?: string | null
  brand_name?: string | null
}

// Convert a Cloudinary URL to the JPG transform Higgsfield needs (webp causes
// credit refunds). Non-Cloudinary URLs pass through untouched.
export function toHiggsfieldJpg(url: string): string {
  if (!url || !url.includes('res.cloudinary.com')) return url
  const transformed = /\/upload\/[^/]*f_jpg/.test(url)
    ? url
    : url.replace('/upload/', '/upload/f_jpg,q_90,w_1024/')
  return transformed.replace(/\.(webp|png|jpe?g|avif)$/i, '')
}

// ── Model variation ───────────────────────────────────────────────────────────
// To avoid reproducing any real person's likeness (copyright / right-of-publicity),
// every shoot uses a DIFFERENT, fictional model. We randomise the identity
// (age, hair colour, skin tone, features) per generation and add an explicit
// "invent a new person, do not resemble anyone real" instruction in the prompt.
const MODEL_HAIR_COLOUR = [
  'dark brown', 'soft black', 'jet black', 'chestnut brown', 'warm chestnut',
  'auburn', 'deep espresso brown', 'ash blonde', 'honey blonde', 'light brown', 'cool brunette',
]
const MODEL_SKIN_TONE = [
  'fair', 'light', 'light olive', 'olive', 'warm tan', 'golden brown', 'deep brown', 'rich dark brown',
]
const MODEL_AGE = [
  'in her mid 20s', 'in her late 20s', 'around 30', 'in her early 30s', 'in her mid 30s',
]
const MODEL_FEATURES = [
  'fresh natural features', 'striking editorial features', 'soft understated features',
  'angular modern features', 'classic refined features', 'distinctive high-fashion features',
]

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

// A fresh, randomised description of a fictional model. Called per generation so
// the face/hair changes every time. Skin is described as one overall complexion
// (used consistently head-to-toe — see the MODEL clause in buildGenerationPrompt).
export function randomModelSubject(): string {
  return `a fictional female fashion model ${pick(MODEL_AGE)} with ${pick(MODEL_HAIR_COLOUR)} hair and an even ${pick(MODEL_SKIN_TONE)} complexion, ${pick(MODEL_FEATURES)}, slim build, minimal makeup`
}

// Build the editorial generation prompt for a pose + a set of outfit items.
// A different fictional model is generated each call (see randomModelSubject).
export function buildGenerationPrompt(combo: HiggsfieldCombo, items: ShootItem[]): string {
  const subject = randomModelSubject()
  const garments = items
    .map((it) => {
      const fabric = it.material_primary ? `${it.material_primary} ` : ''
      const type = (it.item_type ?? it.slot ?? '').toString().replace(/_/g, ' ')
      const name = it.product_name ? `"${it.product_name}"` : ''
      const brand = it.brand_name ? `by ${it.brand_name}` : ''
      return `a ${fabric}${type} ${name} ${brand}`.replace(/\s+/g, ' ').trim()
    })
    .filter(Boolean)
    .join(', ')

  const productRefCount = items.filter((it) => it.image_url).slice(0, 5).length
  const productRefs = productRefCount === 1 ? 'the first reference image' : `the first ${productRefCount} reference images`

  // Only relevant when an actual pose IMAGE is sent (POSE B).
  const poseGuide = combo.poseRef
    ? 'The FINAL reference image is a POSE-AND-LIGHTING GUIDE ONLY — copy its pose, framing and lighting, but completely IGNORE the person, face, skin tone, clothing, colours, background and styling shown in it. '
    : ''

  return `${subject}, hair ${combo.hair}, wearing ${garments || 'the items shown in the product reference images'}. ` +
    `MODEL — render ONE single, coherent, photorealistic woman. CRITICAL: her face, neck, shoulders, arms, hands and legs must ALL be the SAME person with ONE uniform, consistent skin tone and complexion head-to-toe — the head must clearly belong to the body, with NO mismatched or differing skin colours and NO pasted-on, swapped, or floating face. She is a fresh, fictional model who does not resemble any real, recognisable or famous person. The reference photos show ONLY the clothing — do NOT take her face, body, or skin tone from them; simply dress this one coherent model in those exact garments. ` +
    `GARMENTS — reproduce each piece EXACTLY as shown in ${productRefs}: match the fabric and texture, the silhouette, the cut, the length, the neckline, sleeves, and every visible detail and trim. Do not restyle or substitute. ` +
    `COLOUR — take the exact colour of every garment from its product reference photo: reproduce the true hue, depth, warmth and saturation faithfully. Do NOT wash out, desaturate, lighten, or shift any garment toward white, ivory or cream. ` +
    `POSE: ${combo.pose}. ` +
    poseGuide +
    `BACKGROUND: flat seamless studio only, no props, no runway, no audience. ` +
    `LIGHTING: ${combo.lighting}. ` +
    `Fashion editorial photography, 35mm lens, photorealistic, ONE single subject only, full-length head-to-toe, no smiling, no outdoor or busy background.`
}

// Reference images: the outfit's item photos (Cloudinary→JPG) plus the pose
// reference image when the chosen pose has one (POSE B only).
export function buildReferenceUrls(combo: HiggsfieldCombo, items: ShootItem[]): string[] {
  const itemRefs = items
    .filter((it) => it.image_url)
    .map((it) => toHiggsfieldJpg(it.image_url as string))
    .slice(0, 5)
  return combo.poseRef ? [...itemRefs, combo.poseRef] : itemRefs
}
