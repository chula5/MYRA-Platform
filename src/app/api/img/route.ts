import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url')
  if (!url) return new NextResponse('Missing url', { status: 400 })

  // Only proxy tag-walk CDN images
  if (!url.startsWith('https://cdn.tag-walk.com/')) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  try {
    const res = await fetch(url, {
      headers: {
        'Referer': 'https://www.tag-walk.com/',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    })

    if (!res.ok) return new NextResponse('Image not found', { status: 404 })

    const buffer = await res.arrayBuffer()
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': res.headers.get('content-type') || 'image/jpeg',
        'Cache-Control': 'public, max-age=86400',
      },
    })
  } catch {
    return new NextResponse('Failed to fetch image', { status: 500 })
  }
}
