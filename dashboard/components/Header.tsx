// Auth-aware header. Reads the logged-in rep on the server, shows nav based on role,
// and includes a sign-out button. Replaces the previous Founder/Sales toggle.

import Link from "next/link";
import { LayoutDashboard, Sparkles, Users, Phone, Trophy, ShieldCheck, LogOut } from "lucide-react";
import { getCurrentRep } from "@/lib/auth/supabase-server";
import HeaderClientControls from "./HeaderClientControls";

const SALES_NAV = [
  { href: "/queue",       label: "Daily Queue", icon: Phone },
  { href: "/leaderboard", label: "Leaderboard", icon: Trophy },
  { href: "/leads",       label: "Leads",       icon: Users },
];

const FOUNDER_NAV = [
  { href: "/",         label: "Overview",     icon: LayoutDashboard },
  { href: "/insights", label: "Insights",     icon: Sparkles },
  { href: "/queue",    label: "Sales Queue",  icon: Phone },
  { href: "/leads",    label: "Leads",        icon: Users },
  { href: "/leaderboard", label: "Leaderboard", icon: Trophy },
];

const ADMIN_NAV = [
  ...FOUNDER_NAV,
  { href: "/admin/payouts", label: "Payouts", icon: ShieldCheck },
  { href: "/admin/team",    label: "Team",    icon: Users },
  { href: "/admin/audit",   label: "Audit",   icon: ShieldCheck },
];

function navForRole(role: string) {
  if (role === "admin")    return ADMIN_NAV;
  if (role === "founder")  return FOUNDER_NAV;
  return SALES_NAV;
}

export default async function Header({ lastSync }: { lastSync?: string }) {
  const rep = await getCurrentRep();
  const role = rep?.role || "sales";
  const nav = navForRole(role);

  return (
    <header className="border-b border-fg-border bg-white/85 backdrop-blur sticky top-0 z-30">
      <div className="max-w-[1500px] mx-auto px-6 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-5 min-w-0">
          <Link href={role === "sales" ? "/queue" : "/"} className="flex items-center gap-2.5 shrink-0">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center font-bold text-white shadow-sm">L</div>
            <div className="hidden sm:block">
              <div className="text-[13px] font-semibold tracking-tight text-fg-text leading-tight">LevelUp · Sales Intelligence</div>
              <div className="text-[11px] text-fg-muted leading-tight">{rep ? `Logged in as ${rep.full_name || rep.email} · ${role}` : "Forge data live"}</div>
            </div>
          </Link>
          <nav className="flex items-center gap-1 overflow-x-auto">
            {nav.map(n => {
              const Icon = n.icon;
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors text-fg-muted hover:text-fg-text hover:bg-fg-surface whitespace-nowrap"
                >
                  <Icon className="w-3.5 h-3.5" />{n.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="hidden md:flex items-center gap-1.5 text-xs text-fg-muted">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Live
            {lastSync && <span className="ml-1 text-fg-subtle">· {lastSync}</span>}
          </div>
          {rep && <HeaderClientControls email={rep.email} />}
        </div>
      </div>
    </header>
  );
}
