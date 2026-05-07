"use client";

// Top-level view toggles that drive the merged Dashboard. State persists
// in URL search params so refresh / share-link stays sticky.
//
//   ?view=marketing|revenue   (perspective)
//   ?slice=products|timelines (slice)
//   ?period=all|today|7d|30d|mtd|custom
//   ?family=all|forge|live

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback } from "react";
import { TrendingUp, IndianRupee, Layers, BarChart3 } from "lucide-react";

export type DashboardView = "marketing" | "revenue";
export type DashboardSlice = "products" | "timelines";

export default function DashboardViewToggle() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const view = (params.get("view") as DashboardView) || "marketing";
  const slice = (params.get("slice") as DashboardSlice) || "products";
  const period = params.get("period") || "30d";
  const family = params.get("family") || "all";

  const setParam = useCallback((key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    next.set(key, value);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }, [params, pathname, router]);

  return (
    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-5">
      <div className="flex flex-wrap items-center gap-3">
        {/* View toggle: Marketing | Revenue */}
        <div className="inline-flex rounded-lg border border-fg-border bg-fg-card p-0.5">
          <ToggleBtn active={view === "marketing"} onClick={() => setParam("view", "marketing")}
            icon={<TrendingUp className="w-3.5 h-3.5" />} label="Marketing" />
          <ToggleBtn active={view === "revenue"} onClick={() => setParam("view", "revenue")}
            icon={<IndianRupee className="w-3.5 h-3.5" />} label="Revenue" />
        </div>
        {/* Slice toggle: Products | Timelines */}
        <div className="inline-flex rounded-lg border border-fg-border bg-fg-card p-0.5">
          <ToggleBtn active={slice === "products"} onClick={() => setParam("slice", "products")}
            icon={<Layers className="w-3.5 h-3.5" />} label="Products" />
          <ToggleBtn active={slice === "timelines"} onClick={() => setParam("slice", "timelines")}
            icon={<BarChart3 className="w-3.5 h-3.5" />} label="Timelines" />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {/* Family chips */}
        <div className="inline-flex rounded-lg border border-fg-border bg-fg-card p-0.5">
          {(["all", "forge", "live"] as const).map(f => (
            <button key={f}
              onClick={() => setParam("family", f)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                family === f ? "bg-forge-yellow text-forge-black" : "text-fg-muted hover:text-fg-text"
              }`}>
              {f === "all" ? "All" : f === "forge" ? "Forge" : "Live"}
            </button>
          ))}
        </div>
        {/* Period chips */}
        <div className="inline-flex rounded-lg border border-fg-border bg-fg-card p-0.5 flex-wrap">
          {(["today","7d","30d","mtd","all"] as const).map(p => (
            <button key={p}
              onClick={() => setParam("period", p)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                period === p ? "bg-forge-orange text-white" : "text-fg-muted hover:text-fg-text"
              }`}>
              {p === "today" ? "Today" : p === "mtd" ? "MTD" : p === "all" ? "All" : p.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ToggleBtn({ active, onClick, icon, label }: any) {
  return (
    <button onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
        active ? "bg-forge-yellow text-forge-black" : "text-fg-muted hover:text-fg-text"
      }`}>
      {icon}
      {label}
    </button>
  );
}
