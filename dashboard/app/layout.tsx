import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "LevelUp · Marketing & Sales Intelligence",
  description: "Live P&L, MQL pipeline, and the sales daily call queue across LevelUp programs.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-fg-bg text-fg-text min-h-screen antialiased">{children}</body>
    </html>
  );
}
