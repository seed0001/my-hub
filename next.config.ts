import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // msedge-tts must run from node_modules, not the webpack bundle — bundling
  // resolves its isomorphic-ws dependency to the browser build, which breaks
  // the websocket connection to Edge TTS (hangs/403s at runtime).
  serverExternalPackages: ["msedge-tts"],
  eslint: {
    // Don't fail the Railway build on lint warnings.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
