export type Source = 'photos' | 'instagram' | 'manual';
export type Bucket = 'people' | 'inspiration' | 'notes';
export type Status = 'new' | 'drafted' | 'sent' | 'dismissed';
export type Destination = 'clipboard' | 'markdown' | 'json' | 'canva';

export const BUCKETS: Bucket[] = ['people', 'inspiration', 'notes'];

export const BUCKET_LABEL: Record<Bucket, string> = {
  people: 'People',
  inspiration: 'Inspiration',
  notes: 'Notes',
};

export const BUCKET_BLURB: Record<Bucket, string> = {
  people: 'Profiles you screenshotted and never messaged.',
  inspiration: 'Posts you saved instead of making your own.',
  notes: 'Thoughts you had once and filed away forever.',
};

export interface Item {
  id: string;
  created_at: string;
  source: Source;
  bucket: Bucket | null;
  image_url: string | null;
  extracted_text: string | null;
  captured_at: string | null;
  status: Status;
}

export interface Draft {
  id: string;
  item_id: string;
  draft_text: string;
  draft_type: string;
  generated_at: string;
  edited_by_user: number;
  version: number;
}

export interface Settings {
  my_business_description: string;
  my_tone_of_voice: string;
  my_offer: string;
  photos_connected: number;
  instagram_connected: number;
  instagram_token: string | null;
  instagram_user_id: string | null;
  updated_at: string | null;
}

export interface Row {
  item: Item;
  draft: Draft | null;
}
