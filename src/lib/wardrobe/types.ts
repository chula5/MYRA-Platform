import type { ItemType, ColourFamily } from '@/types/database'
import type { Slot } from '@/lib/composer'
import type { AnalysedProduct } from '@/app/admin/items/analyse-url'

export type OwnerKind = 'pilot_member' | 'auth_user'
export interface OwnerRef {
  kind: OwnerKind
  id: string
}

// Stage 1 — what the detector returns for ONE garment in a photo.
export interface DetectedGarment {
  name: string                 // "navy linen shirt"
  item_type: ItemType
  category: Slot               // derived from item_type
  colour_family: ColourFamily | null
  colour_hex: string | null
  material_guess: string | null
  pattern: 'none' | 'tonal' | 'subtle' | 'graphic' | 'statement'
  silhouette: string | null    // "relaxed, hip-length, dropped shoulder"
  description: string          // one sentence, what is visibly there
  brand_hint: string | null    // only if a label/logo is legible
  bounding_box: { x: number; y: number; width: number; height: number } // 0..1000
  confidence: number           // 0..1
}

export type ExtractionStatus =
  | 'detected' | 'cutout_queued' | 'cutout_running' | 'scoring'
  | 'review' | 'approved' | 'discarded' | 'failed'

export interface OwnedMetadata {
  owned_since?: string | null
  fit_notes?: string | null
  favourite?: boolean | null
  brand_label?: string | null
  notes?: string | null
  low_confidence_dims?: string[]
}

// Reviewer edits merged over detected + scores at approval time.
export interface ExtractionEdits {
  product_name?: string | null
  item_type?: string | null
  colour_family?: string | null
  colour_hex?: string | null
  material_primary?: string | null
  material_category?: string | null
  brand_name?: string | null
  estimated_value?: number | null
  owned_since?: string | null
  fit_notes?: string | null
  favourite?: boolean | null
  notes?: string | null
  // any scored dimension override, e.g. { fit: 3, structure: 4 }
  scores?: Partial<Record<keyof AnalysedProduct, number | string | null>>
}

export interface WardrobeExtraction {
  extraction_id: string
  photo_id: string
  batch_id: string | null
  owner_user_id: string
  owner_kind: OwnerKind
  position: number
  status: ExtractionStatus
  detected: DetectedGarment
  crop_url: string | null
  cutout_url: string | null
  cutout_attempts: number
  regen_direction: string | null
  scores: AnalysedProduct | null
  low_confidence_dims: string[]
  edits: ExtractionEdits
  item_id: string | null
  error: string | null
  created_at: string
  updated_at: string
  reviewed_at: string | null
  // joined for the review card
  photo_signed_url?: string | null
  photo_name?: string | null
}

export interface WardrobePhoto {
  photo_id: string
  batch_id: string | null
  owner_user_id: string
  owner_kind: OwnerKind
  storage_path: string
  original_name: string | null
  mime_type: string | null
  width: number | null
  height: number | null
  bytes: number | null
  status: 'uploaded' | 'detecting' | 'detected' | 'no_garments' | 'failed' | 'deleted'
  garment_count: number
  error: string | null
  created_at: string
  deleted_at: string | null
  signed_url?: string | null
}

export interface WardrobeBatch {
  batch_id: string
  owner_user_id: string
  owner_kind: OwnerKind
  created_by: 'admin' | 'client'
  label: string | null
  photo_count: number
  status: 'open' | 'processing' | 'done'
  created_at: string
}

export interface BatchCost {
  batch_id: string
  calls: number
  detect_usd: number
  cutout_usd: number
  score_usd: number
  total_usd: number
  estimated_calls: number
  images_generated: number
}

export interface ApiUsage {
  input_tokens?: number | null
  output_tokens?: number | null
  image_input_tokens?: number | null
  image_output_tokens?: number | null
}
