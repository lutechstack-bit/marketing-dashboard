import Link from "next/link";
import { Activity } from "lucide-react";

export default function Header({ lastSync }: { lastSync?: string }) {
  return (
    <header className="border-b border-fg-border bg-fg-bg/80 backdrop-blur sticky top-0 z-20">
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-3 hover:opacity-90">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-forge to-amber-700 flex items-center justify-center font-bold text-fg-bg shadow-lg shadow-amber-900/30">
              L
            </div>
            <div>
              <div className="text-sm font-semibold tracking-tight">LevelUp · Marketing Intelligence</div>
              <div className="text-xs text-fg-muted">v1 · Forge data live</div>
            </div>
          </Link>
          <nav className="flex items-center gap-1 ml-4">
            <Link href="/" className="px-3 py-1.5 text-sm text-fg-muted hover:text-fg-text rounded transition-colors">
              Founders
            </Link>
            <Link href="/leads" className="px-3 py-1.5 text-sm text-fg-muted hover:text-fg-text rounded transition-colors">
              Leads
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-2 text-xs text-fg-muted">
          <Activity className="w-4 h-4 text-emerald-500" />
          <span>Live</span>
          {lastSync && <span className="ml-2 text-fg-muted/70 hidden md:inline">· last sync {lastSync}</span>}
        </div>
      </div>
    </header>
  );
}
