/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@smm/ui", "@smm/connectors", "@smm/db", "@smm/auth", "@smm/queue", "@smm/storage"],
  images: {
    remotePatterns: [
      { protocol: "http", hostname: "**" },
      { protocol: "https", hostname: "**" },
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
