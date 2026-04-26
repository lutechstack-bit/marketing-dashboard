import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Light surfaces
        "fg-bg":      "#FFFFFF",
        "fg-card":    "#FFFFFF",
        "fg-surface": "#F8FAFC",
        "fg-border":  "#E5E7EB",
        "fg-muted":   "#64748B",
        "fg-subtle":  "#94A3B8",
        "fg-text":    "#0F172A",
        // Program family accents
        "forge":       "#EAB308",  // amber-yellow — Forge (umbrella)
        "live":        "#3B82F6",
        "masterclass": "#A855F7",
        "b2b":         "#10B981",
        // Per-program (Forge) — user's chosen scheme:
        // FFM = yellow, FW = sky (light blue), FC = red, FAI = indigo (dark blue)
        "ffm": "#EAB308",   // yellow-500
        "fw":  "#38BDF8",   // sky-400 (light blue)
        "fc":  "#EF4444",   // red-500
        "fai": "#4338CA",   // indigo-700 (dark blue)
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "Menlo", "monospace"],
      },
      boxShadow: {
        card:        "0 1px 2px 0 rgb(0 0 0 / 0.04), 0 1px 3px 0 rgb(0 0 0 / 0.06)",
        "card-hover":"0 4px 6px -1px rgb(0 0 0 / 0.08), 0 2px 4px -2px rgb(0 0 0 / 0.06)",
        soft:        "0 0 0 1px rgb(0 0 0 / 0.04), 0 4px 12px -4px rgb(15 23 42 / 0.08)",
      },
    },
  },
  plugins: [],
};
export default config;
