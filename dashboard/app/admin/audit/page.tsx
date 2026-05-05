import Header from "@/components/Header";
import { supabase } from "@/lib/supabase";
import { getCurrentRep } from "@/lib/auth/supabase-server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Activity, ChevronRight } from "lucide-react";
import { inr, fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const STATUS_COLOR: Record<string, string> = {
  locked:    "text-amber-700",
  unlocked:  "text-emerald-700",
  approved:  "text-cyan-700",
  paid_out:  "text-slate-700",
  reverted:  "text-rose-700",
};

export default async function AuditPage() {
  const rep = await getCurrentRep();
  if (!rep) redirect("/login?next=/admin/audit");
  if (rep.role !== "admin" && rep.role !== "founder") redirect("/");

  const [auditRes, earningsRes, repsRes, leadsRes] = await Promise.all([
    supabase.from("earnings_audit").select("*").order("created_at", { ascending: false }).limit(500),
    supabase.from("incentive_earnings").select("id,lead_id,rep_id,product_code,amount_inr").limit(2000),
    supabase.from("sales_reps").select("id,full_name,email"),
    supabase.from("leads").select("id,name,email").limit(10000),
  ]);

  const audit = (auditRes.data || []) as any[];
  const earningsById = Object.fromEntries(((earningsRes.data || []) as any[]).map(e => [e.id, e]));
  const repsById = Object.fromEntries(((repsRes.data || []) as any[]).map(r => [r.id, r]));
  const leadsById = Object.fromEntries(((leadsRes.data || []) as any[]).map(l => [l.id, l]));

  return (
    <>
      <Header />
      <main className="max-w-[1400px] mx-auto px-6 py-6">
        <div className="mb-5">
          <h1 className="text-3xl font-bold tracking-tight text-fg-text inline-flex items-center gap-2">
            <Activity className="w-7 h-7 text-cyan-600" />
            Earnings Audit Log
          </h1>
          <p className="text-sm text-fg-muted mt-1">Every state transition for every earning. Full traceability for refund disputes or rep questions.</p>
        </div>

        <div className="surface-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-fg-surface border-b border-fg-border">
              <tr className="text-left text-[11px] uppercase tracking-wider text-fg-muted">
                <th className="py-3 pl-4 pr-2 font-medium">When</th>
                <th className="py-3 px-2 font-medium">Transition</th>
                <th className="py-3 px-2 font-medium">Rep · Lead</th>
                <th className="py-3 px-2 font-medium">Product</th>
                <th className="py-3 px-2 font-medium text-right">Amount</th>
                <th className="py-3 px-2 font-medium">Changed by</th>
                <th className="py-3 pr-4 pl-2 font-medium">Reason</th>
              </tr>
            </thead>
            <tbody>
              {audit.length === 0 ? (
                <tr><td colSpan={7} className="py-12 text-center text-sm text-fg-muted">No audit entries yet — they appear when payments come in or admins act.</td></tr>
              ) : audit.map((a: any) => {
                const e = earningsById[a.earning_id];
                const repId = e?.rep_id;
                const r = repId ? repsById[repId] : null;
                const lead = e?.lead_id ? leadsById[e.lead_id] : null;
                const changedBy = a.changed_by ? repsById[a.changed_by] : null;
                return (
                  <tr key={a.id} className="border-b border-fg-border/70 row-hover">
                    <td className="py-3 pl-4 pr-2 text-xs text-fg-muted whitespace-nowrap">
                      {new Date(a.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })}
                    </td>
                    <td className="py-3 px-2 text-xs whitespace-nowrap">
                      {a.from_status && <span className={`${STATUS_COLOR[a.from_status] || "text-fg-muted"}`}>{a.from_status}</span>}
                      {a.from_status && <span className="mx-1 text-fg-subtle">→</span>}
                      <span className={`font-semibold ${STATUS_COLOR[a.to_status] || "text-fg-text"}`}>{a.to_status}</span>
                    </td>
                    <td className="py-3 px-2 max-w-[200px]">
                      <div className="font-medium text-fg-text truncate">{r?.full_name || r?.email || "—"}</div>
                      {lead && (
                        <Link href={`/leads/${lead.id}`} className="text-[11px] text-fg-muted hover:text-amber-700 hover:underline truncate block">
                          {lead.name || lead.email || "—"}
                        </Link>
                      )}
                    </td>
                    <td className="py-3 px-2 text-fg-text/85">{e?.product_code || "—"}</td>
                    <td className="py-3 px-2 text-right tabular-nums font-semibold text-emerald-700">{e ? inr(e.amount_inr) : "—"}</td>
                    <td className="py-3 px-2 text-xs text-fg-muted">
                      {changedBy ? (changedBy.full_name || changedBy.email) : <span className="italic">system</span>}
                    </td>
                    <td className="py-3 pr-4 pl-2 text-xs text-fg-muted max-w-[280px] truncate" title={a.reason}>
                      {a.reason || ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-fg-subtle mt-4 text-center">
          Last 500 events. Older entries available via SQL.
        </p>
      </main>
    </>
  );
}
