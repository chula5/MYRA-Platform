// MEMBER AVATAR — configuration.
//
// Two suppliers, chosen from the sandbox of 6–9 November 2026:
//   the FACE   — OpenAI GPT Image, the only model that kept Chloe's likeness
//   everything else — Google's Nano Banana on Vertex AI (paid tier, no training on uploads)
//
//   GOOGLE_CLOUD_PROJECT              the Google Cloud project (myra-508821)
//   GOOGLE_SA_KEY                     the service-account JSON, base64 (Vercel), or
//   GOOGLE_APPLICATION_CREDENTIALS    a path to that JSON (local)
//   GOOGLE_CLOUD_LOCATION             default global (the image models live there)
//   AVATAR_BODY_MODEL                 default gemini-3-pro-image
//   AVATAR_DRESS_MODEL                default gemini-nano-banana-2.1
//   OPENAI_API_KEY                    required for the portrait
//   AVATAR_PORTRAIT_MODEL             default gpt-image-2.6

export const AVATAR_CONFIG = {
  project: process.env.GOOGLE_CLOUD_PROJECT || '',
  location: process.env.GOOGLE_CLOUD_LOCATION || 'global',
  bodyModel: process.env.AVATAR_BODY_MODEL || 'gemini-3-pro-image',
  dressModel: process.env.AVATAR_DRESS_MODEL || 'gemini-nano-banana-2.1',
  portraitModel: process.env.AVATAR_PORTRAIT_MODEL || 'gpt-image-2.6',
  imageSize: '2K' as const,          // 1696 × 2528 at 2:3 — the size every layer shares
  aspect: '2:3' as const,
  storageBucket: 'avatar-photos',
  cloudinaryFolder: 'avatar',
  signedUrlSeconds: 60 * 60,
  minPhotos: 3,
  maxPhotos: 6,
  maxPhotoBytes: 12 * 1024 * 1024,
  portraitCandidates: 2,
  maxAttempts: 2,
  // what one picture costs, so admin can show spend by member (Google list prices, Nov 2026)
  costGbp: { body: 0.11, dress: 0.045, portrait: 0.15 },
}

export function googleConfigured(): boolean {
  return !!AVATAR_CONFIG.project && !!(process.env.GOOGLE_SA_KEY || process.env.GOOGLE_APPLICATION_CREDENTIALS)
}

export function openAiConfigured(): boolean {
  return (process.env.OPENAI_API_KEY ?? '').trim().length > 0
}

export function avatarConfigured(): { ok: boolean; missing: string[] } {
  const missing: string[] = []
  if (!googleConfigured()) missing.push('GOOGLE_CLOUD_PROJECT + GOOGLE_SA_KEY')
  if (!openAiConfigured()) missing.push('OPENAI_API_KEY')
  return { ok: missing.length === 0, missing }
}
