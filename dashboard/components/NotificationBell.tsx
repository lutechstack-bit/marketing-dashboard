"use client";

// Header notification bell — shows count of overdue + due-today tasks.
// Polls every 60s. Clicking jumps to /queue (where the TasksPanel lives).

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";

export default function NotificationBell() {
  const [counts, setCounts] = useState<{ overdue: number; today: number; total: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch("/api/tasks/counts", { cache: "no-store" });
        if (!r.ok) return;
        const j = await r.json();
        if (!cancelled) setCounts(j);
      } catch { /* swallow */ }
    }
    load();
    const id = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const total = counts?.total ?? 0;
  const showBadge = total > 0;

  return (
    <Link
      href="/queue"
      title={
        counts
          ? `${counts.overdue} overdue · ${counts.today} due today`
          : "Your follow-ups"
      }
      className="relative inline-flex items-center justify-center w-9 h-9 rounded-md text-fg-muted hover:text-forge-black hover:bg-forge-yellow-pale transition-colors"
    >
      <Bell className="w-4 h-4" />
      {showBadge && (
        <span className={`absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center ${
          (counts?.overdue ?? 0) > 0 ? "bg-rose-500 text-white" : "bg-forge-yellow text-forge-black"
        }`}>
          {total > 99 ? "99+" : total}
        </span>
      )}
    </Link>
  );
}
