import type { MetadataRoute } from 'next'
import { PRESS } from '@/lib/press'
import { SITE_URL } from '@/lib/site'

// The public pages only: home, press and each article, privacy.
export default function sitemap(): MetadataRoute.Sitemap {
  const newest = PRESS[0]?.date ? new Date(PRESS[0].date) : new Date()
  return [
    { url: `${SITE_URL}/`, lastModified: new Date(), changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE_URL}/press`, lastModified: newest, changeFrequency: 'monthly', priority: 0.7 },
    ...PRESS.map((a) => ({
      url: `${SITE_URL}/press/${a.slug}`,
      lastModified: new Date(a.date),
      changeFrequency: 'yearly' as const,
      priority: 0.6,
    })),
    { url: `${SITE_URL}/privacy`, changeFrequency: 'yearly', priority: 0.2 },
  ]
}
