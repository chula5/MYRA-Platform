// API spend per call, so a batch shows what onboarding a wardrobe actually
// costs. Prices are USD per 1M tokens; override by env if they move.
//
//   WARDROBE_PRICE_<MODEL-ID-UPPERCASED-WITH-DASHES-AS-UNDERSCORES>=in,out
//   e.g. WARDROBE_PRICE_GPT_5_6_TERRA=2,12
//   WARDROBE_PRICE_ANTHROPIC=5,25          (the scoring model)

import type { ApiUsage } from './types'

interface Price { inputPerM: number; outputPerM: number; imageInputPerM?: number; imageOutputPerM?: number }

const DEFAULT_PRICES: Record<string, Price> = {
  // OpenAI gpt-5.6 family (developers.openai.com/api/docs/pricing, Aug 2026)
  'gpt-5.6': { inputPerM: 4, outputPerM: 20 },
  'gpt-5.6-sol': { inputPerM: 4, outputPerM: 20 },
  'gpt-5.6-terra': { inputPerM: 2, outputPerM: 12 },
  'gpt-5.6-luna': { inputPerM: 0.2, outputPerM: 1.2 },
  // OpenAI image models: text in / image in / image out
  'gpt-image-2': { inputPerM: 5, outputPerM: 30, imageInputPerM: 8, imageOutputPerM: 30 },
  'gpt-image-1.5': { inputPerM: 5, outputPerM: 32, imageInputPerM: 8, imageOutputPerM: 32 },
  'gpt-image-1': { inputPerM: 5, outputPerM: 40, imageInputPerM: 10, imageOutputPerM: 40 },
  // Anthropic scoring pass (claude-opus-4-6 in analyseProductImage). Override
  // with WARDROBE_PRICE_ANTHROPIC if the tier changes.
  anthropic: { inputPerM: 5, outputPerM: 25 },
}

// Approximate output tokens for one generated image when the API returns no
// usage block — gpt-image tokenisation by quality, portrait 1024x1536.
const IMAGE_OUTPUT_TOKENS_ESTIMATE: Record<string, number> = { low: 408, medium: 1584, high: 6240 }
const IMAGE_INPUT_TOKENS_ESTIMATE = 1500
const IMAGE_PROMPT_TOKENS_ESTIMATE = 350

function envPrice(key: string): Price | null {
  const raw = process.env[`WARDROBE_PRICE_${key.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`]
  if (!raw) return null
  const [a, b] = raw.split(',').map((s) => Number(s.trim()))
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return { inputPerM: a, outputPerM: b, imageOutputPerM: b }
}

export function priceFor(model: string): Price {
  return (
    envPrice(model) ??
    DEFAULT_PRICES[model] ??
    DEFAULT_PRICES[model.replace(/-\d{4}-\d{2}-\d{2}$/, '')] ??
    { inputPerM: 0, outputPerM: 0 }
  )
}

/** Cost of a text/vision call from its usage block. */
export function textCallCost(model: string, usage: ApiUsage | null | undefined): { usd: number; estimated: boolean } {
  const p = priceFor(model)
  const inTok = usage?.input_tokens ?? 0
  const outTok = usage?.output_tokens ?? 0
  if (!usage || (inTok === 0 && outTok === 0)) return { usd: 0, estimated: true }
  return { usd: (inTok * p.inputPerM + outTok * p.outputPerM) / 1_000_000, estimated: false }
}

/** Cost of one image generation/edit call. Uses usage when present, else an estimate. */
export function imageCallCost(
  model: string,
  usage: ApiUsage | null | undefined,
  quality: 'low' | 'medium' | 'high',
): { usd: number; estimated: boolean } {
  const p = priceFor(model)
  const imgOut = p.imageOutputPerM ?? p.outputPerM
  const imgIn = p.imageInputPerM ?? p.inputPerM
  if (usage && ((usage.output_tokens ?? 0) > 0 || (usage.image_output_tokens ?? 0) > 0)) {
    const textIn = (usage.input_tokens ?? 0) - (usage.image_input_tokens ?? 0)
    const usd =
      (Math.max(0, textIn) * p.inputPerM +
        (usage.image_input_tokens ?? 0) * imgIn +
        (usage.image_output_tokens ?? usage.output_tokens ?? 0) * imgOut) /
      1_000_000
    return { usd, estimated: false }
  }
  const usd =
    (IMAGE_PROMPT_TOKENS_ESTIMATE * p.inputPerM +
      IMAGE_INPUT_TOKENS_ESTIMATE * imgIn +
      (IMAGE_OUTPUT_TOKENS_ESTIMATE[quality] ?? IMAGE_OUTPUT_TOKENS_ESTIMATE.high) * imgOut) /
    1_000_000
  return { usd, estimated: true }
}

export function fmtUsd(n: number): string {
  if (n < 0.01 && n > 0) return `$${n.toFixed(4)}`
  return `$${n.toFixed(2)}`
}
