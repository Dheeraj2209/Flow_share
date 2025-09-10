import type { NextConfig } from "next";

const isStaticExport = process.env.STATIC_EXPORT === '1';

const common: NextConfig = {
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
};

const nextConfig: NextConfig = isStaticExport
  ? {
      ...common,
      // Static export for GitHub Pages
      output: 'export',
      trailingSlash: true,
      images: { unoptimized: true },
    }
  : {
      ...common,
      // Default server build for backend hosting
    };

export default nextConfig;
