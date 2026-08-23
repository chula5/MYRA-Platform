// Wardrobe Import — configuration.
//
// Models are configurable by env so a new OpenAI release is a one-line change
// in Vercel, not a deploy. Defaults are the current generation at the time of
// writing (Aug 2026): the gpt-5.6 family for vision (terra = the balanced
// tier; sol is the frontier model, luna the cheap one) and gpt-image-2 for the
// cutouts.
//
//   OPENAI_API_KEY          required for detect + cutout
//   OPENAI_VISION_MODEL     default gpt-5.6-terra
//   OPENAI_IMAGE_MODEL      default gpt-image-2
//   OPENAI_IMAGE_QUALITY    low | medium | high (default medium)
//   OPENAI_API_BASE_URL     default https://api.openai.com/v1
//
// Scoring (stage 3) is NOT OpenAI — it is the exact same Anthropic vision pass
// retail items go through (analyseProductImage), on purpose.

export const WARDROBE_CONFIG = {
  visionModel: process.env.OPENAI_VISION_MODEL || 'gpt-5.6-terra',
  imageModel: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2',
  // MEDIUM, not high. High costs ~$0.20 and ~80s per garment; medium is ~$0.06
  // and roughly half the time. Nothing consumes a high-fidelity render — the
  // cutout is shown at ~128px in review, ~200px in the wardrobe grid, ~110px in
  // the lookbook panel, and toHiggsfieldJpg downsizes it to 1024px wide before
  // it is ever used as a shoot reference. Set OPENAI_IMAGE_QUALITY=high if a
  // particular wardrobe needs the detail.
  imageQuality: (process.env.OPENAI_IMAGE_QUALITY || 'medium') as 'low' | 'medium' | 'high',
  imageSize: '1024x1536' as const, // portrait — matches the 3:4 item cards
  apiBase: (process.env.OPENAI_API_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
  maxGarmentsPerPhoto: 8,
  maxPhotoBytes: 12 * 1024 * 1024,
  cutoutAttemptsCap: 4,
  cloudinaryFolder: 'wardrobe',
  storageBucket: 'wardrobe-photos',
  signedUrlSeconds: 60 * 60,
  // Queue: ONE job at a time — a 12-photo upload never fires 12 generations.
  queueStaleMs: 10 * 60_000,
  queueMaxAttempts: 2,
}

export function openAiApiKey(): string {
  return process.env.OPENAI_API_KEY ?? ''
}

export function openAiConfigured(): boolean {
  return openAiApiKey().trim().length > 0
}
