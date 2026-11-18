import type { Config } from "tailwindcss";

/**
 * Paleta estilo iOS (modo oscuro).
 *
 * Los grises `neutral-*` que ya usa toda la app pasan a ser los grises del
 * sistema de Apple (fondo negro puro, systemGray6 … systemGray). Así cada
 * pantalla (ajustes, paneles, diálogos) toma el aspecto nuevo sin tocar su
 * lógica. Los acentos (`sky`, `emerald`, `red`, `amber`) pasan a los colores
 * del sistema: azul, verde, rojo y naranja.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        neutral: {
          50: "#f2f2f7",
          100: "#e5e5ea",
          200: "#d1d1d6",
          300: "#c7c7cc",
          400: "#aeaeb2",
          500: "#8e8e93",
          600: "#636366",
          700: "#3a3a3c",
          800: "#2c2c2e",
          900: "#1c1c1e",
          950: "#000000",
        },
        sky: {
          300: "#70b7ff",
          400: "#409cff",
          500: "#0a84ff",
          600: "#0a6cff",
          700: "#0050c8",
        },
        emerald: {
          300: "#6ee59a",
          400: "#30d158",
          500: "#30d158",
          600: "#248a3d",
        },
        red: {
          300: "#ff8a80",
          400: "#ff6961",
          500: "#ff453a",
          600: "#d70015",
        },
        amber: {
          300: "#ffd48a",
          400: "#ffb340",
          500: "#ff9f0a",
        },
        // Burbujas de iMessage: azul con texto blanco (4.6:1) y gris oscuro.
        bubble: {
          mine: "#0a6cff",
          other: "#262629",
        },
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          '"SF Pro Text"',
          '"SF Pro Display"',
          '"Segoe UI"',
          "Roboto",
          '"Helvetica Neue"',
          "Arial",
          "sans-serif",
        ],
      },
      transitionTimingFunction: {
        ios: "cubic-bezier(0.32, 0.72, 0, 1)",
      },
    },
  },
  plugins: [],
};

export default config;
