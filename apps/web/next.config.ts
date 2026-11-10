import path from 'node:path';
import type { NextConfig } from 'next';

/**
 * ADR-2: the browser talks to ONE origin. In dev/staging Next proxies /api/* to Express (rewrite below);
 * in production a reverse proxy (Caddy/nginx) routes /api/* straight to Express so cookies stay first-party.
 */
// 127.0.0.1, not localhost: the API binds IPv4 loopback and 'localhost' may resolve to ::1 first (Windows/Node 17+).
const API_ORIGIN = process.env.API_ORIGIN ?? 'http://127.0.0.1:4000';

/**
 * Production CSP: everything same-origin; no third-party scripts, styles, fonts or connections. 'unsafe-inline' is
 * needed for Next's inline bootstrap scripts without nonces (follow-up: nonce-based CSP via middleware).
 * Dev mode additionally needs 'unsafe-eval' (React refresh), so it keeps only the framing rules.
 */
const CSP = process.env.NODE_ENV === 'production'
  ? [
      "default-src 'self'", "script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
      "font-src 'self' data:", "connect-src 'self'", "object-src 'none'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'",
    ].join('; ')
  : "frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

const config: NextConfig = {
  output: 'standalone',
  // Monorepo root: the standalone bundle must trace @edunex/shared from here, never from a lockfile further up the disk.
  outputFileTracingRoot: path.join(__dirname, '..', '..'),
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ['@edunex/shared'],
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_ORIGIN}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Content-Security-Policy', value: CSP },
        ],
      },
    ];
  },
};

export default config;
