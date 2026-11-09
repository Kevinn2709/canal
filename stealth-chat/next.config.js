/**
 * next.config.js — Headers de seguridad y anti-caché.
 *
 * Objetivo: que el navegador no guarde copias de la app ni de sus respuestas,
 * y endurecer el contexto de ejecución. Esto reduce rastro en caché; recuerda
 * que no controla swap del SO ni extensiones del navegador.
 */

/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Nada se cachea: ni en disco ni en memoria del navegador.
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate, max-age=0" },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },

          // Content Security Policy: el relay es el único origen externo
          // permitido para conexiones. Ajusta 'connect-src' a tu dominio real.
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data:",
              // conexiones WebSocket/HTTP solo a 'self' y al relay:
              "connect-src 'self' http://localhost:4000 ws://localhost:4000 wss:",
              "object-src 'none'",
              "base-uri 'self'",
              "frame-ancestors 'none'", // no se puede embeber en un iframe
            ].join("; "),
          },

          // Endurecimiento estándar.
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "geolocation=(), microphone=(), camera=()" },
        ],
      },
    ];
  },

  // No generamos source maps en producción (menos información expuesta).
  productionBrowserSourceMaps: false,
};

module.exports = nextConfig;
