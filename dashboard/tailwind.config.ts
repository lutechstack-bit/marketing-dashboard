import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  // Theme is driven by [data-theme="dark"] on <html>, set BEFORE first paint
  // by the inline script in app/layout.tsx. Surfaces and text flip via CSS
  // variables (RGB triples → opacity-aware) so brand classes stay constant
  // and existing class names like text-forge-black auto-adapt.
  theme: {
    extend: {
      colors: {
        // ------- THEME-AWARE TOKENS (flip via CSS variables) -------
        // RGB triple form supports Tailwind's /<opacity> modifier:
        //   bg-fg-card/85 → rgb(var(--surface) / 0.85)
        "fg-bg":            "rgb(var(--bg) / <alpha-value>)",
        "fg-card":          "rgb(var(--surface) / <alpha-value>)",
        "fg-surface":       "rgb(var(--surface-2) / <alpha-value>)",
        "fg-surface-2":     "rgb(var(--surface-3) / <alpha-value>)",
        "fg-border":        "rgb(var(--border) / <alpha-value>)",
        "fg-border-strong": "rgb(var(--border-strong) / <alpha-value>)",
        "fg-muted":         "rgb(var(--text-muted) / <alpha-value>)",
        "fg-subtle":        "rgb(var(--text-subtle) / <alpha-value>)",
        "fg-text":          "rgb(var(--text) / <alpha-value>)",

        // forge-black / forge-cream are SEMANTIC and theme-flip:
        // - light: warm-black on cream
        // - dark:  cream on near-black
        "forge-black":      "rgb(var(--text) / <alpha-value>)",
        "forge-cream":      "rgb(var(--surface-2) / <alpha-value>)",

        // forge-yellow-soft / pale auto-flip via theme tokens
        "forge-yellow-soft": "rgb(var(--brand-yellow-soft) / <alpha-value>)",
        "forge-yellow-pale": "rgb(var(--brand-yellow-pale) / <alpha-value>)",

        // ------- BRAND ACCENTS (fixed — they pop on both themes) -------
        "forge-yellow":      "#FFBC3B",
        "forge-orange":      "#FFA800",
        "forge-orange-deep": "#DD6F15",

        // Per-program accents
        "ffm": "#EAB308",
        "fw":  "#38BDF8",
        "fc":  "#EF4444",
        "fai": "#4338CA",
        "forge":       "#FFBC3B",
        "live":        "#3B82F6",
        "masterclass": "#A855F7",
        "b2b":         "#10B981",
      },
      fontFamily: {
        sans:    ["'Open Sauce Sans'", "Inter", "system-ui", "sans-serif"],
        display: ["'Playfair Display'", "Georgia", "serif"],
        mono:    ["ui-monospace", "Menlo", "monospace"],
      },
      boxShadow: {
        card:        "0 1px 2px 0 rgb(0 0 0 / 0.04), 0 1px 3px 0 rgb(0 0 0 / 0.06)",
        "card-hover":"0 4px 6px -1px rgb(0 0 0 / 0.08), 0 2px 4px -2px rgb(0 0 0 / 0.06)",
        soft:        "0 0 0 1px rgb(0 0 0 / 0.04), 0 4px 12px -4px rgb(34 34 34 / 0.08)",
        "forge-glow": "0 0 0 4px rgb(255 188 59 / 0.15), 0 4px 12px -2px rgb(255 188 59 / 0.25)",
      },
      backgroundImage: {
        "forge-gradient":  "linear-gradient(135deg, #FFBC3B 0%, #FFA800 50%, #DD6F15 100%)",
        // forge-radial / forge-stripes are theme-aware via the .bg-forge-*
        // classes defined in globals.css. The inline utility uses var() so
        // it still works even when used as a Tailwind class.
        "forge-radial":    "var(--brand-radial)",
        "forge-stripes":   "var(--brand-stripes)",
      },
    },
  },
  plugins: [],
};
export default config;
