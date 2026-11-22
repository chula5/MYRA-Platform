import type { MetadataRoute } from 'next'
import { PRIVATE_EXACT, PRIVATE_PATHS, SITE_URL } from '@/lib/site'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: [...PRIVATE_PATHS, ...PRIVATE_EXACT] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  }
}
