'use server'

export interface ProductInfo {
  productName: string
  brandName: string
}

export async function scrapeProductInfo(url: string): Promise<{ data?: ProductInfo; error?: string }> {
  if (!url) return { error: 'No URL provided' }

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-GB,en;q=0.9',
      },
      next: { revalidate: 0 },
    })

    if (!res.ok) return { error: `Could not fetch page (${res.status})` }

    const html = await res.text()

    // Extract from common meta tags and structured data
    const productName = extractProductName(html)
    const brandName = extractBrandName(html, url)

    if (!productName && !brandName) {
      return { error: 'Could not extract product info from this page' }
    }

    return { data: { productName: productName ?? '', brandName: brandName ?? '' } }
  } catch (err) {
    console.error('[scrapeProductInfo]', err)
    return { error: 'Failed to fetch product page' }
  }
}

function extractProductName(html: string): string | null {
  const patterns = [
    // Open Graph
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,
    // JSON-LD structured data
    /"name"\s*:\s*"([^"]+)"/,
    // Twitter card
    /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i,
    // Standard title tag — strip site name suffix
    /<title[^>]*>([^<]+)<\/title>/i,
  ]

  for (const pattern of patterns) {
    const match = html.match(pattern)
    if (match?.[1]) {
      let name = match[1].trim()
      // Strip common site name suffixes (e.g. "Product Name | Net-A-Porter")
      name = name.replace(/\s*[|–—-]\s*.{2,40}$/, '').trim()
      // Skip if it's clearly a site name rather than a product
      if (name.length > 3 && name.length < 200) return name
    }
  }
  return null
}

function extractBrandName(html: string, url: string): string | null {
  // Try JSON-LD brand field first
  const brandPatterns = [
    /"brand"\s*:\s*\{\s*"[^"]*"\s*:\s*"([^"]+)"/i,
    /"brand"\s*:\s*"([^"]+)"/i,
    /<meta[^>]+property=["']product:brand["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']product:brand["']/i,
    /<meta[^>]+name=["']brand["'][^>]+content=["']([^"']+)["']/i,
  ]

  for (const pattern of brandPatterns) {
    const match = html.match(pattern)
    if (match?.[1]?.trim()) return match[1].trim()
  }

  // Fall back to inferring brand from the URL hostname
  try {
    const hostname = new URL(url).hostname.replace('www.', '')
    const knownBrands: Record<string, string> = {
      'net-a-porter.com': 'Net-A-Porter',
      'mytheresa.com': 'Mytheresa',
      'farfetch.com': 'Farfetch',
      'ssense.com': 'SSENSE',
      'modaoperandi.com': 'Moda Operandi',
      'cos.com': 'COS',
      'arket.com': 'Arket',
      'reiss.com': 'Reiss',
      'whistles.com': 'Whistles',
      'massimodutti.com': 'Massimo Dutti',
      'stories.com': '& Other Stories',
      'toteme-studio.com': 'Toteme',
      'jacquemus.com': 'Jacquemus',
      'khaite.com': 'Khaite',
      'acnestudios.com': 'Acne Studios',
      'therow.com': 'The Row',
      'sandro-paris.com': 'Sandro',
      'maje.com': 'Maje',
      'ganni.com': 'Ganni',
      'zimmermann.com': 'Zimmermann',
      'isabelmarant.com': 'Isabel Marant',
      'matchesfashion.com': 'Matches',
      'selfridges.com': 'Selfridges',
      'harrods.com': 'Harrods',
    }
    return knownBrands[hostname] ?? null
  } catch {
    return null
  }
}
