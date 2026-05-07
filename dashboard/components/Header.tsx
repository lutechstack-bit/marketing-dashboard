// Auth-aware header. Reads the logged-in rep on the server.

import Link from "next/link";
import { LayoutDashboard, Sparkles, Users, Phone, Trophy, ShieldCheck, Activity, Upload } from "lucide-react";
import { getCurrentRep } from "@/lib/auth/supabase-server";
import HeaderClientControls from "./HeaderClientControls";
import ForgeWordmark from "./ForgeWordmark";
import ThemeToggle from "./ThemeToggle";
import NotificationBell from "./NotificationBell";

const SALES_NAV = [
  { href: "/queue",       label: "Queue",        icon: Phone },
  { href: "/leaderboard", label: "Leaderboard",  icon: Trophy },
  { href: "/leads",       label: "Leads",        icon: Users },
];

const FOUNDER_NAV = [
  { href: "/",            label: "Dashboard",    icon: LayoutDashboard },
  { href: "/queue",       label: "Queue",        icon: Phone },
  { href: "/leaderboard", label: "Leaderboard",  icon: Trophy },
  { href: "/leads",       label: "Leads",        icon: Users },
];

const ADMIN_NAV = [
  ...FOUNDER_NAV,
  { href: "/admin/payouts", label: "Payouts", icon: ShieldCheck },
  { href: "/admin/team",    label: "Team",    icon: Users },
  { href: "/admin/import",  label: "Import",  icon: Upload },
  { href: "/admin/audit",   label: "Audit",   icon: Activity },
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
    <header className="border-b border-fg-border bg-fg-card/85 backdrop-blur sticky top-0 z-30">
      <div className="max-w-[1500px] mx-auto px-6 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-5 min-w-0">
          <Link href={role === "sales" ? "/queue" : "/"} className="flex items-center gap-3 shrink-0 group">
            <div className="w-10 h-10 rounded-xl bg-forge-gradient flex items-center justify-center shadow-card group-hover:shadow-forge-glow transition-shadow">
              <span className="font-display font-extrabold italic text-forge-black text-lg leading-none">L</span>
            </div>
            <div className="hidden sm:flex flex-col leading-tight">
              <ForgeWordmark size="sm" subtitle="Sales Intelligence" />
              {rep && (
                <span className="text-[10px] text-fg-muted leading-tight mt-0.5">
                  {rep.full_name || rep.email} · {role}
                </span>
              )}
            </div>
          </Link>
          <nav className="flex items-center gap-1 overflow-x-auto">
            {nav.map(n => {
              const Icon = n.icon;
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  prefetch={true}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors text-fg-muted hover:text-forge-black hover:bg-forge-yellow-pale whitespace-nowrap font-medium"
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
          {rep && <NotificationBell />}
          <ThemeToggle />
          {rep && <HeaderClientControls email={rep.email} />}
        </div>
      </div>
    </header>
  );
}
