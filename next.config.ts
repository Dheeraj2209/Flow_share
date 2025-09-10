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
      // Support project-site deployments under a subpath
      basePath: process.env.BASE_PATH || undefined,
      assetPrefix: process.env.ASSET_PREFIX || undefined,
    }
  : {
      ...common,
      // Default server build for backend hosting
    };

export default nextConfig;
