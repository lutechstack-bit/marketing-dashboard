import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Light surfaces tuned for the Forge cream + warm-black palette
        "fg-bg":      "#FFFFFF",
        "fg-card":    "#FFFFFF",
        "fg-surface": "#FCF7EF",   // brand cream — warmer than slate
        "fg-surface-2": "#F5EFE2", // slightly deeper cream for stripes
        "fg-border":  "#E8DFCB",   // warm border (cream-tinted)
        "fg-muted":   "#6B6358",   // warm gray
        "fg-subtle":  "#A39A8B",   // warm subtle
        "fg-text":    "#222222",   // brand warm-black
        // Forge brand palette (from official Forge Brand Kit)
        "forge-yellow":      "#FFBC3B",   // signature
        "forge-yellow-soft": "#FFEFBA",
        "forge-yellow-pale": "#FFF8E7",
        "forge-orange":      "#FFA800",   // bold accent
        "forge-orange-deep": "#DD6F15",   // depth/hover
        "forge-cream":       "#FCF7EF",
        "forge-black":       "#222222",
        // Per-program (Forge) accents (kept from founder's earlier scheme)
        "ffm": "#EAB308",   // yellow
        "fw":  "#38BDF8",   // sky
        "fc":  "#EF4444",   // red
        "fai": "#4338CA",   // indigo
        // Family accents for nav badges
        "forge":       "#FFBC3B",
        "live":        "#3B82F6",
        "masterclass": "#A855F7",
        "b2b":         "#10B981",
      },
      fontFamily: {
        sans:    ["Inter", "system-ui", "sans-serif"],
        display: ["'Playfair Display'", "Georgia", "serif"],   // Migra Extrabold alternative
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
        "forge-radial":    "radial-gradient(ellipse at top, #FFF8E7 0%, transparent 60%)",
        "forge-stripes":   "repeating-linear-gradient(135deg, #FFEFBA 0px, #FFEFBA 12px, #FFF8E7 12px, #FFF8E7 24px)",
      },
    },
  },
  plugins: [],
};
export default config;
