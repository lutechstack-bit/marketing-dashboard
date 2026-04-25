import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Forge-brand inspired dark palette
        "fg-bg": "#0A0A0B",
        "fg-card": "#141416",
        "fg-border": "#27272A",
        "fg-muted": "#71717A",
        "fg-text": "#FAFAFA",
        // Program family accents
        "forge": "#F59E0B",       // amber — Forge premium offline
        "live": "#3B82F6",        // blue — online Live programs
        "masterclass": "#A855F7", // purple — masterclasses
        "b2b": "#10B981",         // emerald — B2B
        // Per-program (Forge) colors — for charts
        "ffm": "#EF4444",         // red — Filmmaking
        "fw":  "#06B6D4",         // cyan — Writing
        "fc":  "#84CC16",         // lime — Creators
        "fai": "#F59E0B",         // amber — AI
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};
export default config;
