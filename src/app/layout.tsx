import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sitio en mantenimiento",
  description: "",
  robots: { index: false, follow: false }, // privado: que no lo indexen buscadores
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Tienda", statusBarStyle: "black" },
  icons: { icon: "/favicon-32.png", apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#000000",
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    // data-vista lo pone el script de abajo antes de pintar (ver BOOT_SCRIPT).
    <html lang="es" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}

/**
 * Arranque sin parpadeo: si en este equipo lo último que se vio fue el
 * monitor (un fundador con la sesión recordada), se muestra su esqueleto en
 * lugar de la landing mientras Firebase responde. Se borra al cerrar sesión.
 */
const BOOT_SCRIPT = `try{if(location.pathname==="/"&&localStorage.getItem("canal:vista")==="monitor")document.documentElement.dataset.vista="monitor"}catch(e){}`;
