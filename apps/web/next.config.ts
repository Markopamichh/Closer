import type { NextConfig } from "next";

const apiUrl = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  transpilePackages: ["@closer/shared"],
  // The browser only ever talks to this origin; /api/* is proxied to the Hono API.
  // Same-origin means first-party cookies and no CORS surface.
  rewrites: () => Promise.resolve([{ source: "/api/:path*", destination: `${apiUrl}/api/:path*` }]),
};

export default nextConfig;
