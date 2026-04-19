// ── Auto-generated Supabase types ────────────────────────────────
// Run `npm run types` to regenerate from your Supabase schema.
// Requires: SUPABASE_PROJECT_ID env var set.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      brand: {
        Row: {
          brand_id: string
          name: string
          price_tier: number
          era_orientation: number
          aesthetic_output: number
          cultural_legibility: number
          creative_behaviour: number
          notes: string | null
        }
        Insert: Omit<Database['public']['Tables']['brand']['Row'], 'brand_id'> & { brand_id?: string }
        Update: Partial<Database['public']['Tables']['brand']['Row']>
      }
      item: {
        Row: {
          item_id: string
          brand_id: string
          item_type: ItemType
          product_name: string
          retailer_url: string
          image_url: string
          price: string | null
          currency: string | null
          in_inventory: boolean
          source: 'manual' | 'retailer_api' | 'web_discovery'
          status: 'draft' | 'ready' | 'live' | 'archived'
          admin_notes: string | null
          fit: number | null
          length: number | null
          rise: number | null
          structure: number | null
          shoulder: number | null
          waist_definition: number | null
          leg_opening: number | null
          surface: number | null
          colour_depth: number | null
          pattern: number | null
          sheen: number | null
          colour_hex: string | null
          colour_family: ColourFamily | null
          material_category: MaterialCategory | null
          material_weight: number | null
          material_formality: number | null
          material_primary: string | null
          jewellery_scale: number | null
          jewellery_finish: JewelleryFinish | null
          jewellery_formality: number | null
          jewellery_style: JewelleryStyle | null
          jewellery_material_primary: string | null
          jewellery_layering: boolean | null
          notes: string | null
        }
        Insert: Omit<Database['public']['Tables']['item']['Row'], 'item_id'> & { item_id?: string }
        Update: Partial<Database['public']['Tables']['item']['Row']>
      }
      outfit: {
        Row: {
          outfit_id: string
          image_url: string
          additional_images: string[] | null
          aesthetic_label: string
          occasion_tags: string[]
          source_brand_ids: string[]
          status: 'draft' | 'in_review' | 'live' | 'archived'
          project_id: string | null
          admin_notes: string | null
          published_at: string | null
          created_at: string
          formality: number
          planning: number
          wearer_priority: number
          time_of_day: number
          construction: number
          surface_story: number
          volume: number
          colour_story: number
          intent: number
          outerwear_construction: number | null
          outerwear_volume: number | null
          outerwear_material_weight: number | null
          outerwear_material_formality: number | null
          top_construction: number | null
          top_volume: number | null
          top_material_weight: number | null
          top_material_formality: number | null
          bottom_construction: number | null
          bottom_volume: number | null
          bottom_rise: number | null
          bottom_leg_opening: number | null
          bottom_material_weight: number | null
          shoe_formality: number | null
          shoe_style: number | null
          bag_formality: number | null
          jewellery_scale: number | null
          jewellery_formality: number | null
          taste_vector: number[] | null
        }
        Insert: Omit<Database['public']['Tables']['outfit']['Row'], 'outfit_id' | 'created_at'> & { outfit_id?: string; created_at?: string }
        Update: Partial<Database['public']['Tables']['outfit']['Row']>
      }
      outfit_item: {
        Row: {
          outfit_item_id: string
          outfit_id: string
          item_id: string
          slot: 'outerwear' | 'top' | 'bottom' | 'dress' | 'shoe' | 'bag' | 'jewellery' | 'accessory'
          sort_order: number | null
        }
        Insert: Omit<Database['public']['Tables']['outfit_item']['Row'], 'outfit_item_id'> & { outfit_item_id?: string }
        Update: Partial<Database['public']['Tables']['outfit_item']['Row']>
      }
      taste_event: {
        Row: {
          event_id: string
          user_id: string
          outfit_id: string
          item_id: string | null
          event_type: TasteEventType
          signal_weight: number
          occasion_context: string
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['taste_event']['Row'], 'event_id' | 'created_at'> & { event_id?: string; created_at?: string }
        Update: Partial<Database['public']['Tables']['taste_event']['Row']>
      }
      user_taste_profile: {
        Row: {
          user_id: string
          taste_vector: number[] | null
          brand_affinities: string[]
          price_tier_range: number[]
          updated_at: string
        }
        Insert: Database['public']['Tables']['user_taste_profile']['Row']
        Update: Partial<Database['public']['Tables']['user_taste_profile']['Row']>
      }
      admin_project: {
        Row: {
          project_id: string
          title: string
          status: 'draft' | 'in_review' | 'live' | 'archived'
          outfit_ids: string[]
          cover_image_url: string | null
          notes: string | null
          created_at: string
          published_at: string | null
        }
        Insert: Omit<Database['public']['Tables']['admin_project']['Row'], 'project_id' | 'created_at'> & { project_id?: string; created_at?: string }
        Update: Partial<Database['public']['Tables']['admin_project']['Row']>
      }
      lookbook: {
        Row: {
          lookbook_id: string
          title: string
          slug: string
          description: string | null
          sort_order: number
          status: 'active' | 'archived'
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['lookbook']['Row'], 'lookbook_id' | 'created_at'> & { lookbook_id?: string; created_at?: string }
        Update: Partial<Database['public']['Tables']['lookbook']['Row']>
      }
      lookbook_outfit: {
        Row: {
          lookbook_outfit_id: string
          lookbook_id: string
          outfit_id: string
          sort_order: number
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['lookbook_outfit']['Row'], 'lookbook_outfit_id' | 'created_at'> & { lookbook_outfit_id?: string; created_at?: string }
        Update: Partial<Database['public']['Tables']['lookbook_outfit']['Row']>
      }
    }
    Views: {}
    Functions: {
      find_similar_outfits: {
        Args: {
          query_vector: number[]
          occasion_filter: string
          match_count: number
          exclude_ids: string[]
        }
        Returns: Database['public']['Tables']['outfit']['Row'][]
      }
      get_outfits_for_item: {
        Args: {
          p_item_id: string
          p_exclude_outfit_id: string
          p_limit: number
        }
        Returns: Database['public']['Tables']['outfit']['Row'][]
      }
    }
    Enums: {}
  }
}

// ── Convenience type aliases ──────────────────────────────────
export type Outfit = Database['public']['Tables']['outfit']['Row']
export type Item = Database['public']['Tables']['item']['Row']
export type Brand = Database['public']['Tables']['brand']['Row']
export type OutfitItem = Database['public']['Tables']['outfit_item']['Row']
export type TasteEvent = Database['public']['Tables']['taste_event']['Row']
export type UserTasteProfile = Database['public']['Tables']['user_taste_profile']['Row']
export type AdminProject = Database['public']['Tables']['admin_project']['Row']
export type Lookbook = Database['public']['Tables']['lookbook']['Row']
export type LookbookOutfit = Database['public']['Tables']['lookbook_outfit']['Row']

// ── Outfit with nested items (for feed/detail views) ─────────
export type OutfitWithItems = Outfit & {
  outfit_item: (OutfitItem & {
    item: Item & {
      brand: Brand
    }
  })[]
}

// ── Enums ─────────────────────────────────────────────────────
export type ItemType =
  | 'coat' | 'trench' | 'jacket' | 'blazer' | 'gilet' | 'cape'
  | 'shirt' | 'blouse' | 't-shirt' | 'knitwear' | 'corset' | 'bodysuit'
  | 'trousers' | 'jeans' | 'shorts' | 'skirt'
  | 'mini_dress' | 'midi_dress' | 'maxi_dress' | 'shirt_dress' | 'slip_dress'
  | 'boot' | 'heel' | 'flat' | 'sneaker' | 'mule' | 'sandal'
  | 'tote' | 'shoulder_bag' | 'clutch' | 'crossbody' | 'structured_bag'
  | 'belt' | 'scarf' | 'necklace' | 'earrings' | 'bracelet' | 'ring' | 'brooch'
  | 'hair_accessory' | 'hat' | 'gloves' | 'sunglasses'

export type ColourFamily =
  | 'white' | 'cream' | 'black' | 'grey' | 'navy' | 'brown' | 'camel'
  | 'green' | 'burgundy' | 'red' | 'blue' | 'pink' | 'yellow' | 'orange'
  | 'purple' | 'multicolour'

export type MaterialCategory =
  | 'natural_woven' | 'natural_knit' | 'synthetic_woven' | 'synthetic_knit'
  | 'leather_suede' | 'technical' | 'mixed'

export type JewelleryFinish =
  | 'yellow_gold' | 'white_gold' | 'rose_gold' | 'silver' | 'oxidised'
  | 'mixed_metal' | 'plated' | 'resin' | 'pearl' | 'gemstone' | 'enamel' | 'organic'

export type JewelleryStyle =
  | 'fine' | 'costume' | 'artisan' | 'vintage_inspired' | 'architectural'
  | 'organic' | 'minimal' | 'maximalist'

export type TasteEventType =
  | 'like' | 'dislike' | 'save' | 'shop_click' | 'style_tap'
  | 'source_tap' | 'similar_tap' | 'explore_tap' | 'skip'
