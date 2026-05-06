"use client";

// Refresh button — calls /api/cache/invalidate to bust the relevant
// unstable_cache tags then reloads the page. Designed for the mobile app
// view where pull-to-refresh isn't always available.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

export default function RefreshButton({
  tags = ["leads", "meta-ads", "revenue-tracker"],
  label = "Refresh",
  className = "",
}: {
  tags?: string[];
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  async function refresh() {
    setBusy(true);
    try {
      // Bust server caches for the given tags (no-op if endpoint missing)
      await fetch(`/api/cache/invalidate?tags=${tags.join(",")}`, {
        method: "POST",
        cache: "no-store",
      }).catch(() => {});
      // Force re-render of all server components on this page
      router.refresh();
      setLastRefresh(new Date());
    } finally {
      // Brief visual confirmation before re-enabling
      setTimeout(() => setBusy(false), 800);
    }
  }

  const timeAgo = lastRefresh ? `${Math.max(1, Math.round((Date.now() - lastRefresh.getTime()) / 1000))}s ago` : null;

  return (
    <button
      onClick={refresh}
      disabled={busy}
      title={timeAgo ? `Last refreshed ${timeAgo}` : "Refresh data"}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-fg-border bg-fg-card hover:bg-fg-surface disabled:opacity-60 transition-colors ${className}`}
    >
      <RefreshCw className={`w-3.5 h-3.5 ${busy ? "animate-spin" : ""}`} />
      <span>{busy ? "Refreshing…" : label}</span>
    </button>
  );
}
