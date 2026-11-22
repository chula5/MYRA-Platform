import type { MetadataRoute } from 'next'
import { SITE_DESCRIPTION } from '@/lib/site'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'MYRA',
    short_name: 'MYRA',
    description: SITE_DESCRIPTION,
    start_url: '/me',
    display: 'standalone',
    background_color: '#FAFAF8',
    theme_color: '#FAFAF8',
    icons: [
      { src: '/icons/myra-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/myra-512.png', sizes: '512x512', type: 'image/png' },
    ],
  }
}
