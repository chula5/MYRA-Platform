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

// A SECOND dev server (another port) must never share .next-dev with the one
// already running — it wipes the first server's chunks and every page 404s
// until that server restarts (2026-11-08, four times). Next sets PORT on the
// server process once it has actually bound (start-server.js), so a server
// that landed on 3001 or 3002 compiles into .next-dev-3001 / .next-dev-3002
// and the one on 3000 keeps .next-dev. NEXT_DEV_DIST_DIR still overrides.
const devDistDir = () => {
  if (process.env.NEXT_DEV_DIST_DIR) return process.env.NEXT_DEV_DIST_DIR
  const port = process.env.PORT
  return port && port !== '3000' ? `.next-dev-${port}` : '.next-dev'
}

module.exports = (phase) => ({
  ...nextConfig,
  distDir: phase === PHASE_DEVELOPMENT_SERVER ? devDistDir() : '.next',
})
