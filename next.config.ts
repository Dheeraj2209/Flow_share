import type { NextConfig } from "next";

const isStaticExport = process.env.STATIC_EXPORT === '1';

const nextConfig: NextConfig = isStaticExport
  ? {
      // Static export for GitHub Pages
      output: 'export',
      trailingSlash: true,
      images: { unoptimized: true },
    }
  : {
      // Default server build for backend hosting
    };

export default nextConfig;
