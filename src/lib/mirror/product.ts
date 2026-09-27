// The piece a Mirror request describes, read defensively from the page's own words.
import type { SiteProduct } from './style'

export function productFrom(p: any): SiteProduct | null {
  if (!p || typeof p.url !== 'string' || !/^https?:\/\//.test(p.url) || typeof p.title !== 'string') return null
  return {
    url: p.url.slice(0, 500), title: p.title.slice(0, 300),
    brand: typeof p.brand === 'string' ? p.brand.slice(0, 120) : null,
    type: typeof p.type === 'string' ? p.type.slice(0, 80) : null,
    price: typeof p.price === 'number' ? p.price : null,
    image: typeof p.image === 'string' && /^https?:\/\//.test(p.image) ? p.image.slice(0, 800) : null,
    available: typeof p.available === 'boolean' ? p.available : null,
    sizes: Array.isArray(p.sizes) ? p.sizes.slice(0, 60).filter((s: any) => s && typeof s.label === 'string').map((s: any) => ({ label: String(s.label).slice(0, 40), available: !!s.available })) : null,
  }
}
