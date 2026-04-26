import { CampaignPerf } from "@/lib/data";
import { inr, pct, fmtInt } from "@/lib/format";

const PROG_TAG: Record<string, string> = {
  FFM: "text-yellow-800 bg-yellow-50 ring-1 ring-yellow-200",
  FW:  "text-sky-700 bg-sky-50 ring-1 ring-sky-200",
  FC:  "text-red-700 bg-red-50 ring-1 ring-red-200",
  FAI: "text-indigo-800 bg-indigo-50 ring-1 ring-indigo-200",
};

export default function CampaignPerformance({ campaigns }: { campaigns: CampaignPerf[] }) {
  const top = campaigns.slice(0, 12);
  return (
    <div className="surface-card p-6 animate-fade-in">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-fg-text">Campaign performance — last 30 days</h2>
        <p className="text-xs text-fg-muted mt-0.5">Sorted by spend · CTR / CPC / CPM live from Meta Marketing API</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] text-fg-muted uppercase tracking-wider border-b border-fg-border bg-fg-surface">
              <th className="py-2.5 pl-3 pr-3 font-medium">Campaign</th>
              <th className="py-2.5 px-3 font-medium">Prog</th>
              <th className="py-2.5 px-3 text-right font-medium">Spend</th>
              <th className="py-2.5 px-3 text-right font-medium">Imps</th>
              <th className="py-2.5 px-3 text-right font-medium">Clicks</th>
              <th className="py-2.5 px-3 text-right font-medium">CTR</th>
              <th className="py-2.5 px-3 text-right font-medium">CPC</th>
              <th className="py-2.5 px-3 text-right font-medium">CPM</th>
              <th className="py-2.5 px-3 text-right font-medium">Leads</th>
              <th className="py-2.5 pl-3 pr-3 text-right font-medium">Buys</th>
            </tr>
          </thead>
          <tbody>
            {top.map((c) => (
              <tr key={c.campaign_id} className="border-b border-fg-border/70 row-hover">
                <td className="py-2 pl-3 pr-3 max-w-[280px]">
                  <div className="text-sm font-medium truncate text-fg-text" title={c.campaign_name}>{c.campaign_name}</div>
                </td>
                <td className="py-2 px-3">
                  <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${PROG_TAG[c.program] || "text-fg-muted bg-fg-surface ring-1 ring-fg-border"}`}>
                    {c.program}
                  </span>
                </td>
                <td className="py-2 px-3 text-right tabular-nums text-fg-text">{inr(c.spend, { compact: true })}</td>
                <td className="py-2 px-3 text-right tabular-nums text-fg-muted">{fmtInt(c.impressions)}</td>
                <td className="py-2 px-3 text-right tabular-nums text-fg-muted">{fmtInt(c.clicks)}</td>
                <td className="py-2 px-3 text-right tabular-nums">
                  <span className={c.ctr >= 1.5 ? "text-emerald-600 font-medium" : c.ctr < 0.7 ? "text-rose-600" : "text-fg-text/85"}>{pct(c.ctr)}</span>
                </td>
                <td className="py-2 px-3 text-right tabular-nums text-fg-text/85">{c.cpc > 0 ? inr(c.cpc) : "—"}</td>
                <td className="py-2 px-3 text-right tabular-nums text-fg-text/85">{c.cpm > 0 ? inr(c.cpm) : "—"}</td>
                <td className="py-2 px-3 text-right tabular-nums text-fg-text/85">{fmtInt(c.leads)}</td>
                <td className="py-2 pl-3 pr-3 text-right tabular-nums font-semibold text-fg-text">{fmtInt(c.purchases)}</td>
              </tr>
            ))}
            {top.length === 0 && (
              <tr><td colSpan={10} className="text-center text-fg-muted py-8 text-sm">No active campaigns in the last 30 days.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
