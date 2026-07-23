/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  eslint: {
    // CI runs `next lint` explicitly; don't fail production builds on lint.
    ignoreDuringBuilds: true,
  },
  async headers() {
    const securityHeaders = [
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
