import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/seo'
import { PRESS } from '@/lib/press'

// Every public page MYRA wants found. Press articles come straight from PRESS,
// so a new article is in the sitemap the moment it is added.
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()
  return [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE_URL}/ai-stylist`, lastModified: now, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${SITE_URL}/press`, lastModified: now, changeFrequency: 'weekly', priority: 0.7 },
    ...PRESS.map((a) => ({
      url: `${SITE_URL}/press/${a.slug}`,
      lastModified: new Date(a.date),
      changeFrequency: 'yearly' as const,
      priority: 0.6,
    })),
    { url: `${SITE_URL}/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
  ]
}
