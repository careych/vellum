import type { NextConfig } from 'next'

const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL ?? ''
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
// Extract just the hostname for CSP (e.g. "xyz.supabase.co")
const supabaseHost = SUPABASE_URL ? new URL(SUPABASE_URL).host : '*.supabase.co'

// Content-Security-Policy
// Notes:
// - 'unsafe-inline' for style-src is required by Tailwind CSS-in-JS patterns
// - 'unsafe-eval' for script-src is required by Next.js fast-refresh in dev;
//   in production Next.js emits only hashed inline scripts but the nonce-based
//   approach requires more infra. Accept this trade-off for now.
// - img-src includes R2 public URL so gallery thumbnails load
// - connect-src includes Supabase REST + realtime (wss)
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${R2_PUBLIC_URL}`,
  "font-src 'self'",
  `connect-src 'self' https://${supabaseHost} wss://${supabaseHost}`,
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ')

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  { key: 'Content-Security-Policy', value: csp },
]

const nextConfig: NextConfig = {
  serverExternalPackages: ['sharp'],

  async headers() {
    return [
      {
        // Apply to every route
        source: '/(.*)',
        headers: securityHeaders,
      },
    ]
  },
}

export default nextConfig
