/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Shared workspace packages are TS source; let Next transpile them.
  transpilePackages: ["@infra-explorer/domain"],
};

export default nextConfig;
