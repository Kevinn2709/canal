/**
 * next.config.js — Headers de seguridad.
 *
 * El CSP permite conexiones solo a este sitio (incluida /api/notify) y a los
 * servicios de Google que usa Firebase (Authentication y Firestore). El
 * service worker (/sw.js) y el manifest se sirven desde este mismo sitio.
 */

const isDev = process.env.NODE_ENV !== "production";

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://apis.google.com`,
  "style-src 'self' 'unsafe-inline'",
  // blob: para mostrar fotos, videos y audios ya descifrados en el dispositivo.
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self'",
  `connect-src 'self' https://*.googleapis.com${isDev ? " ws:" : ""}`,
  "frame-src https://*.firebaseapp.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Permissions-Policy",
            // micrófono solo para este sitio: notas de voz
            value: "geolocation=(), microphone=(self), camera=()",
          },
        ],
      },
      {
        // El service worker siempre fresco: así cada versión nueva se aplica.
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache" }],
      },
    ];
  },
  productionBrowserSourceMaps: false,
};

module.exports = nextConfig;
