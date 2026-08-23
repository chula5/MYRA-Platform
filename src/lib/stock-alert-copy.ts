// Client-safe half of the stock-alert model: the kinds, the words we use for
// them, and the shape the saved list renders. Split out from stock-alerts.ts so
// the wardrobe panel can import the copy without dragging a server-only module
// into the client bundle.

export type AlertKind = 'low_in_size' | 'sold_out_in_size' | 'back_in_size' | 'unique_sold' | 'restyled'
export type SubscriptionSource = 'saved_item' | 'saved_outfit' | 'notify_me'

/** Every line names HER size where we know it — that's the whole point. */
export const ALERT_COPY: Record<AlertKind, (size: string | null) => string> = {
  low_in_size: (s) => (s ? `Only a few left in your size (${s})` : 'Only a few left in your size'),
  sold_out_in_size: (s) => (s ? `Sold out in your size (${s})` : 'Sold out in your size'),
  back_in_size: (s) => (s ? `Back in your size (${s})` : 'Back in your size'),
  unique_sold: () => 'One of one — now sold',
  restyled: () => 'We’ve restyled a look you saved',
}

export interface UserAlert {
  alert_id: string
  item_id: string
  outfit_id: string | null
  kind: AlertKind
  size_label: string | null
  created_at: string
  seen_at: string | null
  product_name: string | null
  brand_name: string | null
  image_url: string | null
}
