import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Canal",
  description: "",
  robots: { index: false, follow: false }, // que no lo indexen buscadores
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
