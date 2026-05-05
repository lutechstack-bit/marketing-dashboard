"use client";

// Light/dark theme toggle. Initial theme is set BEFORE first paint by the
// inline script in app/layout.tsx (reads localStorage); this component just
// exposes a button to flip it after mount.
//
// Order: light → dark → system (match OS preference) → light → ...
// Saves choice to localStorage("theme") and updates [data-theme] on <html>.

import { useEffect, useState } from "react";
import { Moon, Sun, Monitor } from "lucide-react";

type Mode = "light" | "dark" | "system";

function applyTheme(mode: Mode) {
  let resolved: "light" | "dark" = "light";
  if (mode === "system") {
    resolved = typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark" : "light";
  } else {
    resolved = mode;
  }
  document.documentElement.setAttribute("data-theme", resolved);
}

export default function ThemeToggle() {
  const [mode, setMode] = useState<Mode | null>(null);

  // Read saved mode after mount (server doesn't know it)
  useEffect(() => {
    const saved = (typeof window !== "undefined" && localStorage.getItem("theme")) as Mode | null;
    setMode(saved && ["light", "dark", "system"].includes(saved) ? saved : "system");
  }, []);

  // React to OS theme changes when in system mode
  useEffect(() => {
    if (mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [mode]);

  function cycle() {
    const next: Mode = mode === "light" ? "dark" : mode === "dark" ? "system" : "light";
    setMode(next);
    try { localStorage.setItem("theme", next); } catch {}
    applyTheme(next);
  }

  // Pre-mount: render a placeholder so layout doesn't shift
  if (!mode) {
    return <div className="w-9 h-9 rounded-md" aria-hidden />;
  }

  const Icon = mode === "dark" ? Moon : mode === "light" ? Sun : Monitor;
  const tooltip = `Theme: ${mode}${mode === "system" ? " (matches your OS)" : ""} — click to switch`;

  return (
    <button
      onClick={cycle}
      title={tooltip}
      aria-label={tooltip}
      className="inline-flex items-center justify-center w-9 h-9 rounded-md text-fg-muted hover:text-forge-black hover:bg-forge-yellow-pale transition-colors"
    >
      <Icon className="w-4 h-4" />
    </button>
  );
}
