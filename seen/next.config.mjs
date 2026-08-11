/** @type {import('next').NextConfig} */
const nextConfig = {
  // node:sqlite is a Node builtin, but webpack still tries to bundle anything
  // reachable from a server component. Keep it external.
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [...(config.externals || []), 'node:sqlite'];
    }
    return config;
  },
};

export default nextConfig;
