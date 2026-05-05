// Top opportunities — top 5 leads "closest to converting" for a sales rep.
//
// Heuristic: leads at app_fee_paid stage in this rep's assigned programs,
// ranked by score + how stale the last activity is. These are the highest-
// leverage calls a rep can make right now.

import Link from "next/link";
import { Flame, Phone, MessageCircle, Sparkles, ChevronRight } from "lucide-react";
import { fetchTopOpportunities } from "@/lib/sales-stats";
import { inr } from "@/lib/format";

export default async function TopOpportunities({ repId }: { repId: string }) {
  const opportunities = await fetchTopOpportunities(repId);
  if (opportunities.length === 0) return null;

  const totalIncentive = opportunities.reduce((s, o) => s + o.incentive_amount, 0);

  return (
    <div className="surface-card mb-5 overflow-hidden border-l-4 border-l-emerald-500">
      <div className="px-5 py-3 flex items-center justify-between gap-3 flex-wrap bg-emerald-50/60">
        <div className="flex items-center gap-2">
          <Flame className="w-5 h-5 text-emerald-700" />
          <div>
            <div className="font-display text-lg font-extrabold italic text-forge-black">
              Closest to converting
            </div>
            <div className="text-xs text-fg-muted">
              Top {opportunities.length} call-now leads · ₹{(totalIncentive).toLocaleString("en-IN")} in your incentives if all close
            </div>
          </div>
        </div>
      </div>

      <div className="divide-y divide-fg-border/60">
        {opportunities.map((o, i) => (
          <div key={o.lead_id} className="px-5 py-3 flex items-center gap-3 flex-wrap text-sm">
            <span className="text-[10px] font-bold tabular-nums text-fg-subtle w-5">#{i + 1}</span>

            <span className={`inline-flex items-center justify-center w-9 h-9 rounded-md font-bold tabular-nums text-sm ${
              o.score >= 75 ? "bg-forge-gradient text-forge-black"
              : o.score >= 60 ? "bg-forge-yellow-soft text-forge-orange-deep"
              : "bg-fg-surface text-fg-muted"
            }`}>{o.score}</span>

            <div className="flex-1 min-w-0">
              <Link href={`/leads/${o.lead_id}`} className="font-semibold text-forge-black hover:text-forge-orange-deep">
                {o.name || o.email || o.phone || "—"}
              </Link>
              <div className="flex items-center gap-2 text-xs text-fg-muted">
                <span className="font-semibold uppercase tracking-[0.1em] text-[10px]">{o.program}</span>
                <span className="text-fg-subtle">·</span>
                <Sparkles className="w-3 h-3 text-emerald-600 shrink-0" />
                <span className="truncate">{o.reason}</span>
              </div>
            </div>

            <div className="text-right">
              <div className="text-[10px] uppercase tracking-[0.1em] text-fg-muted font-semibold">Your incentive</div>
              <div className="font-bold text-emerald-700 tabular-nums">{inr(o.incentive_amount)}</div>
            </div>

            <div className="flex items-center gap-1">
              {o.phone && (
                <a href={`tel:${o.phone}`} title="Call" className="p-1.5 rounded text-fg-muted hover:text-emerald-700 hover:bg-emerald-50">
                  <Phone className="w-4 h-4" />
                </a>
              )}
              {o.phone && (
                <a href={`https://wa.me/${o.phone.replace(/\D/g, "")}`} target="_blank" rel="noopener" title="WhatsApp" className="p-1.5 rounded text-fg-muted hover:text-emerald-700 hover:bg-emerald-50">
                  <MessageCircle className="w-4 h-4" />
                </a>
              )}
              <Link href={`/leads/${o.lead_id}`} className="p-1.5 rounded text-fg-muted hover:text-forge-orange-deep hover:bg-forge-yellow-pale">
                <ChevronRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
