"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LineChart, Users, Phone, LayoutDashboard } from "lucide-react";

type Role = "founder" | "sales";

const FOUNDER_NAV = [
  { href: "/",       label: "Overview", icon: LayoutDashboard },
  { href: "/leads",  label: "Leads",    icon: Users },
];
// Sales mode: queue is the primary, only view. /leads remains accessible by URL
// but we don't surface it in the nav (founder feedback: it was creating noise).
const SALES_NAV = [
  { href: "/queue",  label: "Daily Queue", icon: Phone },
];

export default function Header({ lastSync }: { lastSync?: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [role, setRole] = useState<Role>("founder");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const saved = (typeof window !== "undefined" && (localStorage.getItem("levelup-role") as Role)) || "founder";
    setRole(saved);
    setMounted(true);
  }, []);

  const switchRole = (r: Role) => {
    if (r === role) return;
    localStorage.setItem("levelup-role", r);
    setRole(r);
    if (r === "sales" && pathname === "/")      router.push("/queue");
    if (r === "founder" && pathname === "/queue") router.push("/");
  };

  const nav = role === "sales" ? SALES_NAV : FOUNDER_NAV;

  return (
    <header className="border-b border-fg-border bg-white/85 backdrop-blur sticky top-0 z-30">
      <div className="max-w-[1500px] mx-auto px-6 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-5 min-w-0">
          <Link href={role === "sales" ? "/queue" : "/"} className="flex items-center gap-2.5 shrink-0">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center font-bold text-white shadow-sm">L</div>
            <div className="hidden sm:block">
              <div className="text-[13px] font-semibold tracking-tight text-fg-text leading-tight">LevelUp · Sales Intelligence</div>
              <div className="text-[11px] text-fg-muted leading-tight">Forge data live · Live · Masterclass · B2B coming</div>
            </div>
          </Link>
          <nav className="flex items-center gap-1">
            {nav.map(n => {
              const Icon = n.icon;
              const active = pathname === n.href || (n.href === "/leads" && pathname?.startsWith("/leads/"));
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors ${
                    active
                      ? "bg-fg-surface text-fg-text font-medium"
                      : "text-fg-muted hover:text-fg-text hover:bg-fg-surface"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />{n.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {/* Role toggle — Founder vs Sales */}
          {mounted && (
            <div className="flex items-center bg-fg-surface border border-fg-border rounded-lg p-0.5">
              <button
                onClick={() => switchRole("founder")}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                  role === "founder" ? "bg-white text-fg-text shadow-sm" : "text-fg-muted hover:text-fg-text"
                }`}
              >Founder</button>
              <button
                onClick={() => switchRole("sales")}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                  role === "sales" ? "bg-white text-fg-text shadow-sm" : "text-fg-muted hover:text-fg-text"
                }`}
              >Sales</button>
            </div>
          )}
          <div className="hidden md:flex items-center gap-1.5 text-xs text-fg-muted">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Live
            {lastSync && <span className="ml-1 text-fg-subtle">· {lastSync}</span>}
          </div>
        </div>
      </div>
    </header>
  );
}
