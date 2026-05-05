import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "LevelUp Learning · Sales Intelligence Dashboard",
  description: "Sales intelligence dashboard for LevelUp Learning — MQL pipeline, daily call queue, leaderboard, and P&L across the Forge programs.",
};

// Inline script: applies the saved theme BEFORE first paint to avoid flash-of-
// wrong-theme. Reads localStorage("theme") in this order:
//   "dark" / "light" → use that
//   "system" or unset → match prefers-color-scheme
// The ThemeToggle component writes to localStorage on user toggle.
const THEME_INIT_SCRIPT = `(function(){try{
  var t = localStorage.getItem("theme");
  if (!t || t === "system") {
    t = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  document.documentElement.setAttribute("data-theme", t);
}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="bg-fg-bg text-fg-text min-h-screen antialiased">{children}</body>
    </html>
  );
}
