import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "LevelUp · Marketing Intelligence",
  description: "Forge marketing dashboard — spend, conversion, CAC, P&L",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-fg-bg text-fg-text min-h-screen">{children}</body>
    </html>
  );
}
