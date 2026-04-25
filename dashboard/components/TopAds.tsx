import { AdPerf } from "@/lib/data";
import { inr, pct, fmtInt } from "@/lib/format";

const PROG_TAG: Record<string, string> = {
  FFM: "text-rose-400 bg-rose-500/10",
  FW:  "text-cyan-400 bg-cyan-500/10",
  FC:  "text-lime-400 bg-lime-500/10",
  FAI: "text-amber-400 bg-amber-500/10",
};

export default function TopAds({ ads }: { ads: AdPerf[] }) {
  return (
    <div className="glow-card rounded-xl p-6 animate-fade-in">
      <div className="mb-4">
        <h2 className="text-lg font-semibold">Top performing ads — last 30 days</h2>
        <p className="text-xs text-fg-muted mt-0.5">Ranked by leads + (purchases × 10) so paid conversions weigh heavier</p>
      </div>
      <div className="space-y-2">
        {ads.map((a, i) => (
          <div key={a.ad_id} className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-fg-card transition-colors">
            <span className="text-xs font-bold text-fg-muted w-6 text-right">{i + 1}</span>
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${PROG_TAG[a.program] || "text-fg-muted bg-fg-border"} shrink-0`}>{a.program}</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate" title={a.ad_name}>{a.ad_name}</div>
              <div className="text-xs text-fg-muted truncate">{a.campaign_name}</div>
            </div>
            <div className="grid grid-cols-4 gap-3 text-right shrink-0 text-xs tabular-nums">
              <div><div className="text-fg-muted text-[10px] uppercase">Spend</div><div>{inr(a.spend, { compact: true })}</div></div>
              <div><div className="text-fg-muted text-[10px] uppercase">CTR</div><div>{pct(a.ctr)}</div></div>
              <div><div className="text-fg-muted text-[10px] uppercase">Leads</div><div>{fmtInt(a.leads)}</div></div>
              <div><div className="text-fg-muted text-[10px] uppercase">Buys</div><div className="font-semibold">{fmtInt(a.purchases)}</div></div>
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
