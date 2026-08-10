/** @type {import('next').NextConfig} */
const nextConfig = {
  // The dev server compiles into its own directory so a production
  // `next build` (which writes to .next) can never clobber the running dev
  // server's CSS/chunks — that's what kept rendering pages as unstyled HTML.
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
      { protocol: 'http', hostname: '**' },
    ],
  },
}

module.exports = nextConfig
