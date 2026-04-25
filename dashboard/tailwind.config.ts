import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Light surfaces — clean white with slate text
        "fg-bg":      "#FFFFFF",   // page background
        "fg-card":    "#FFFFFF",   // card surface (depth via border + shadow)
        "fg-surface": "#F8FAFC",   // hover / table-header / alt surface (slate-50)
        "fg-border":  "#E5E7EB",   // borders (gray-200)
        "fg-muted":   "#64748B",   // secondary text (slate-500)
        "fg-subtle":  "#94A3B8",   // tertiary text (slate-400)
        "fg-text":    "#0F172A",   // primary text (slate-900)
        // Program family accents
        "forge":       "#F59E0B",  // amber — Forge offline residencies
        "live":        "#3B82F6",  // blue  — Live online
        "masterclass": "#A855F7",  // purple — Masterclass
        "b2b":         "#10B981",  // emerald — B2B
        // Per-program (Forge) accents
        "ffm": "#EF4444",   // red — Filmmaking
        "fw":  "#06B6D4",   // cyan — Writing
        "fc":  "#84CC16",   // lime — Creators
        "fai": "#F59E0B",   // amber — AI
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
