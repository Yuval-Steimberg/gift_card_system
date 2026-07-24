/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  eslint: {
    // CI runs `next lint` explicitly; don't fail production builds on lint.
    ignoreDuringBuilds: true,
  },
  async headers() {
    // CSP tuned for Next App Router: 'unsafe-inline' is required for Next's
    // hydration/style injection without a nonce pipeline. img `data:` covers QR
    // data-URLs; `https:` on connect/img covers Supabase + Resend. Frames denied.
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' https:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ')
    const securityHeaders = [
      { key: 'Content-Security-Policy', value: csp },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-DNS-Prefetch-Control', value: 'off' },
      {
        key: 'Permissions-Policy',
        // camera is needed on the employee scanner route only; allow self.
        value: 'camera=(self), microphone=(), geolocation=()',
      },
    ]
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}

export default nextConfig
