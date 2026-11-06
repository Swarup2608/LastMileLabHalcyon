import type { NextConfig } from "next";

// /api/* is forwarded to the Halcyon API by src/app/api/[...path]/route.ts, which reads API_URL at runtime.
const nextConfig: NextConfig = {
  // Self-contained server bundle for Azure App Service (node server.js).
  output: "standalone",
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
