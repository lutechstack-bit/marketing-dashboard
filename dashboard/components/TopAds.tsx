import { AdPerf } from "@/lib/data";
import { inr, pct, fmtInt } from "@/lib/format";

const PROG_TAG: Record<string, string> = {
  FFM: "text-rose-700 bg-rose-50 ring-1 ring-rose-200",
  FW:  "text-cyan-700 bg-cyan-50 ring-1 ring-cyan-200",
  FC:  "text-lime-700 bg-lime-50 ring-1 ring-lime-200",
  FAI: "text-amber-700 bg-amber-50 ring-1 ring-amber-200",
};

export default function TopAds({ ads }: { ads: AdPerf[] }) {
  return (
    <div className="surface-card p-6 animate-fade-in">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-fg-text">Top performing ads — last 30 days</h2>
        <p className="text-xs text-fg-muted mt-0.5">Ranked by leads + (purchases × 10) so paid conversions weigh heavier</p>
      </div>
      <div className="space-y-1.5">
        {ads.map((a, i) => (
          <div key={a.ad_id} className="flex items-center gap-3 py-2 px-3 rounded-lg row-hover transition-colors">
            <span className="text-xs font-bold text-fg-subtle w-6 text-right tabular-nums">{i + 1}</span>
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${PROG_TAG[a.program] || "text-fg-muted bg-fg-surface ring-1 ring-fg-border"} shrink-0`}>{a.program}</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate text-fg-text" title={a.ad_name}>{a.ad_name}</div>
              <div className="text-xs text-fg-muted truncate">{a.campaign_name}</div>
            </div>
            <div className="grid grid-cols-4 gap-3 text-right shrink-0 text-xs tabular-nums">
              <div><div className="text-fg-muted text-[10px] uppercase">Spend</div><div className="text-fg-text">{inr(a.spend, { compact: true })}</div></div>
              <div><div className="text-fg-muted text-[10px] uppercase">CTR</div><div className="text-fg-text">{pct(a.ctr)}</div></div>
              <div><div className="text-fg-muted text-[10px] uppercase">Leads</div><div className="text-fg-text">{fmtInt(a.leads)}</div></div>
              <div><div className="text-fg-muted text-[10px] uppercase">Buys</div><div className="font-semibold text-fg-text">{fmtInt(a.purchases)}</div></div>
            </div>
          </div>
        ))}
        {ads.length === 0 && (
          <div className="text-center text-fg-muted py-8 text-sm">No ad performance data in the last 30 days.</div>
        )}
      </div>
    </div>
  );
}
