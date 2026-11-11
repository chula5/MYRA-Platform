import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/seo'

// Public pages are open to every search engine and AI crawler, named here so
// nobody reads silence as a no: Google (and Google-Extended, which feeds Gemini
// and AI Overviews), Bing (which ChatGPT search also draws on), OpenAI,
// Anthropic and Perplexity. Members' areas, admin and the API stay closed.
const PRIVATE = [
  '/admin',
  '/api/',
  '/me',
  '/studio',
  '/edit',
  '/feed',
  '/onboarding',
  '/settings',
  '/welcome',
  '/mirror',
  '/login',
  '/signin',
  '/reset-password',
  '/partners/',
  '/e/',
  '/go/',
  '/join/',
  '/outfit/',
  '/actions',
]

const AI_CRAWLERS = [
  'Googlebot',
  'Google-Extended',
  'Bingbot',
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-SearchBot',
  'Claude-User',
  'anthropic-ai',
  'PerplexityBot',
  'Perplexity-User',
  'Applebot',
  'Applebot-Extended',
  'DuckAssistBot',
  'CCBot',
]

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: PRIVATE },
      { userAgent: AI_CRAWLERS, allow: '/', disallow: PRIVATE },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  }
}
