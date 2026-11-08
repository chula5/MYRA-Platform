// The sandbox prompts, as proven on Chloe's own avatar (6–9 November 2026). Change with care:
// each clause earned its place (arms away from the body for clean layers, hair behind the
// shoulders, the exact background colour, "not a real or famous person" never used here —
// this IS a real person, hers).

export const STAGE_BG = '#E4E2DD'

const BASE_OUTFIT = 'She wears only a plain fitted light-grey ribbed tank top and plain matching light-grey mid-thigh cycling shorts, barefoot, no jewellery, no sunglasses, no bag.'
const STUDIO = `Flat seamless background in one solid colour, exactly ${STAGE_BG}, soft even frontal studio light, no cast shadow on the background, no props, no text. Photorealistic, sharp, 85mm lens, camera at chest height.`

/** Head and shoulders from her face photos only. */
export function portraitPrompt(): string {
  return `Studio portrait photograph, head and shoulders, of the real woman shown in the reference photos. Reproduce her exact identity so that anyone who knows her would recognise her instantly: her face shape and jawline, her eyes (shape, spacing and colour), her brows, nose and lips, her skin tone and any freckling, and her hair in its real colour, length and texture, worn down and swept behind her shoulders. She faces the camera straight on at eye level with a calm neutral expression, mouth closed, natural makeup only, no jewellery, no sunglasses. She wears a plain fitted light-grey ribbed tank top. ${STUDIO}`
}

/** The A-pose body: image 1 is the chosen portrait, then her full-length photos. */
export function bodyPrompt(heightCm: number | null): string {
  const height = heightCm ? ` She is about ${heightCm} cm tall; keep her real proportions.` : ''
  return `Create a full-length studio photograph of the real woman shown in image 1, a studio portrait of her face: reproduce that exact face and hair precisely, so that anyone who knows her would recognise her instantly. The other images are real photos of her showing her full body, height, build and posture: match her real build and proportions, do not slim or alter her.${height} She stands straight, facing the camera squarely, head level and looking straight into the lens, in a relaxed A-pose: feet hip-width apart, both arms straight and held clearly away from the body at about 25 degrees so there is empty space between each arm and the torso, hands open, calm neutral expression, mouth closed. Her hair is down and swept back behind her shoulders so her neck and shoulders are clear. The head must be in natural proportion to the body. ${BASE_OUTFIT} Her entire body is visible from the top of her head to her toes, centred, with a clear margin above the head and below the feet. ${STUDIO}`
}

/** Paint something flat magenta so it can be cut out exactly. */
export function magentaPrompt(what: string): string {
  return `Image 1 is a photograph. Produce the EXACT same image, pixel for pixel, with one change only: paint ${what} in a completely flat, solid, pure magenta colour (#FF00FF) with no shading, no texture, no folds, no highlights, covering every pixel of it and nothing else, with crisp edges exactly where it ends. Everything else in the picture stays exactly as it is. No other colour changes.`
}
export const HEAD_MASK_WHAT = "the woman's entire head and all of her hair, including the face, ears and neck down to the top of the collarbones"

/** After the portrait head is pasted on: blend, keep the face. */
export const HARMONISE_PROMPT = `Image 1 is a full-length studio photograph in which the head has been pasted on from another photo, so there may be a visible seam at the neck and shoulders, a skin-tone difference between face and body, and the head may be slightly out of proportion. Repair it into one seamless, natural photograph: blend the neck into the shoulders and tank top with no seam, match the face and neck skin tone and lighting to the body, scale the head so it is in natural proportion to the body, and let the hair fall naturally behind the shoulders. KEEP THE FACE EXACTLY AS IT IS: the same person, same features, same expression. Change nothing else: same pose, same clothing, same framing, same flat ${STAGE_BG} background.`

/** The last step: arms down, the way a person stands for a photo. */
export const RELAX_PROMPT = `Image 1 is a full-length studio photograph of a woman standing in an A-pose with her arms held out away from her body. Change ONLY her arms and hands: let both arms hang naturally and relaxed at her sides, close to the body with a small natural gap, elbows soft, hands relaxed with fingers gently curled beside her thighs, the way a person stands normally for a photo. Shoulders relaxed and level. Keep everything else exactly as it is: the same woman with the exact same face, hair and expression, the same straight stance facing the camera with feet hip-width apart, the same grey tank top and shorts, bare feet, the same framing, scale and position in the frame, the same flat ${STAGE_BG} background and lighting. No other change.`

const KEEP_DRESSED = `Keep absolutely everything else identical to image 1: the same woman and face, the exact same relaxed pose with her arms hanging at her sides, the same position, scale and framing (do not move, zoom or re-crop her), everything she already wears wherever it is not covered, the same bare feet unless the piece is shoes, the same flat ${STAGE_BG} background and lighting. Reproduce the garment exactly as in image 2: colour, print, fabric, cut, proportions and length. Add nothing else: no extra clothes, no accessories, no props, no text.`

/** Dress one piece one way. `way` is avatar_way.shoot_prompt with {piece} filled in. */
export function dressPrompt(way: string): string {
  return `Image 1 is a full-length photo of a woman in a fixed pose. Image 2 is a product photo of one item. Edit image 1 so that ${way}. ${KEEP_DRESSED}`
}

/** One real photograph from the stacked layers plus the product photos. */
export function finishPrompt(arrangement: string): string {
  return `Image 1 is a rough collage: a woman in a fixed pose with an outfit assembled from separate cut-out layers, so edges, overlaps and tucking are crude. The other images are the product photos of each piece. Re-render image 1 as ONE natural, coherent photograph of the same woman: same face, same relaxed pose, same framing and scale, same flat ${STAGE_BG} background and lighting. Keep every garment exactly where and how it is arranged in image 1, but make it real: correct layering, natural drape and folds, fabric meeting fabric with proper shadows, nothing poking out that should be hidden. Reproduce each piece faithfully from its product photo (colour, print, fabric, cut, length). Add nothing that is not in image 1. ${arrangement}`
}
