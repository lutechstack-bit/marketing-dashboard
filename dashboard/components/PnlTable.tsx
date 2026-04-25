import { ActualsRow } from "@/lib/data";
import { inr, pct } from "@/lib/format";

const HIGHLIGHT_ROWS = new Set([
  "Revenue from Operations (A)", "Forge", "Application Fee", "B2B",
  "Expenses", "Marketing (incl GST)", "COGS projected", "Payment gateway", "Refunds",
  "Gross P/L", "Marketing spend", "Growth %", "Gross Margin", "GST", "Salaries"
]);

const RELABEL: Record<string, string> = {
  "COGS projected": "COGS (actuals)",
  "Marketing spend": "Marketing %",
};

const PERCENT_ROWS = new Set(["Marketing spend", "Growth %", "Gross Margin"]);

export default function PnlTable({ actuals }: { actuals: ActualsRow[] }) {
  const allMonths = actuals[0]?.values || [];
  const recent = allMonths.slice(-6);

  const rowsToShow = actuals.filter(r => HIGHLIGHT_ROWS.has(r.metric));

  return (
    <div className="surface-card p-6 animate-fade-in">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-fg-text">P&amp;L summary</h2>
        <p className="text-xs text-fg-muted mt-0.5">Last 6 months from your Actuals tab</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] text-fg-muted uppercase tracking-wider border-b border-fg-border bg-fg-surface">
              <th className="py-2.5 pl-3 pr-4 font-medium">Metric</th>
              {recent.map(m => (
                <th key={m.ym} className="py-2.5 px-3 text-right font-medium">
                  {m.year}-{String(m.month).padStart(2, "0")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rowsToShow.map((row) => {
              const isHeader = ["Revenue from Operations (A)", "Expenses", "Gross P/L"].includes(row.metric);
              const isPct = PERCENT_ROWS.has(row.metric);
              return (
                <tr
                  key={row.metric}
                  className={`border-b border-fg-border/70 row-hover ${isHeader ? "font-semibold text-fg-text" : "text-fg-text/85"}`}
                >
                  <td className={`py-2 pr-4 ${isHeader ? "pl-3 text-sm" : "pl-6 text-sm"}`}>{RELABEL[row.metric] || row.metric}</td>
                  {recent.map(m => {
                    const v = row.values.find(x => x.ym === m.ym);
                    const val = v?.value;
                    return (
                      <td key={m.ym} className="py-2 px-3 text-right tabular-nums">
                        {val === null || val === undefined ? <span className="text-fg-subtle">—</span>
                          : isPct ? <span className={val < 0 ? "text-rose-600" : "text-fg-text/90"}>{pct(val * (Math.abs(val) <= 5 ? 100 : 1), 1)}</span>
                          : <span className={val < 0 ? "text-rose-600" : "text-fg-text/90"}>{inr(val, { compact: true })}</span>}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
