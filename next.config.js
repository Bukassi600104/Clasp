/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          // SECURITY (A05): force HTTPS for two years incl. subdomains.
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          // SECURITY (A05 — clickjacking): only Pi may embed the app. We can't use
          // X-Frame-Options (it has no allow-list); CSP frame-ancestors does.
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'self' https://*.pinet.com https://*.minepi.com",
          },
          // SECURITY: deny browser features the app never uses.
          { key: 'Permissions-Policy', value: 'geolocation=(), microphone=(), payment=()' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
