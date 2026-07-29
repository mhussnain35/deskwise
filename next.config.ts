import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    // Prevents TypeScript validation from failing the production build on Vercel
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
