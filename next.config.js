/** @type {import('next').NextConfig} */
const nextConfig = {
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

// The dev server compiles into its OWN directory, so a production
// `next build` (which writes to .next) can never clobber the running dev
// server's chunks/CSS. NODE_ENV isn't reliable when the config is loaded, so
// key off the Next phase instead.
const { PHASE_DEVELOPMENT_SERVER } = require('next/constants')

module.exports = (phase) => ({
  ...nextConfig,
  distDir: phase === PHASE_DEVELOPMENT_SERVER ? '.next-dev' : '.next',
})
