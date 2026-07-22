import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  eslint: {
    // Don't fail the Railway build on lint warnings.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
