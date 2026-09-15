import type { NextConfig } from "next";

// Deploy marker: production-readiness hardening after database housekeeping (2026-08-08).

function normalizeFrameAncestor(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

const configuredFrameAncestors = [
  ...(process.env.IT_ADMIN_FRAME_ANCESTORS ?? "").split(","),
  process.env.NEXT_PUBLIC_IT_ADMIN_URL ?? ""
]
  .map(normalizeFrameAncestor)
  .filter((value): value is string => Boolean(value));

const frameAncestors = Array.from(
  new Set(["'self'", "http://localhost:3000", "http://127.0.0.1:3000", ...configuredFrameAncestors])
).join(" ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Content-Security-Policy", value: `frame-ancestors ${frameAncestors};` },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  allowedDevOrigins: ["127.0.0.1"],
  experimental: {
    lockDistDir: false,
    webpackBuildWorker: false
  },
  transpilePackages: ["@pos/shared-types", "@pos/pos-domain", "@pos/ui"],
  // The transactional RPC path is the production baseline. These explicit
  // build-time defaults override the legacy service-module defaults that used
  // direct multi-request fallbacks when the variables were absent. Emergency
  // compatibility can still be opted into deliberately with Vercel env vars.
  env: {
    POS_FORCE_DIRECT_CREATE_NON_DELIVERY: process.env.POS_FORCE_DIRECT_CREATE_NON_DELIVERY ?? "false",
    POS_FORCE_DIRECT_PAYMENT_COMPLETE: process.env.POS_FORCE_DIRECT_PAYMENT_COMPLETE ?? "false",
    POS_SOFT_BYPASS_INSUFFICIENT_STOCK: process.env.POS_SOFT_BYPASS_INSUFFICIENT_STOCK ?? "false"
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com"
      }
    ]
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders
      }
    ];
  }
};

export default nextConfig;
