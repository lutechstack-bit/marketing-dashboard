import { inr, fmtDate } from "@/lib/format";

const PROGRAM_LABEL: Record<string, { name: string; color: string }> = {
  FFM: { name: "Filmmaking", color: "text-rose-400 bg-rose-500/10" },
  FW: { name: "Writing", color: "text-cyan-400 bg-cyan-500/10" },
  FC: { name: "Creators", color: "text-lime-400 bg-lime-500/10" },
  FAI: { name: "AI", color: "text-amber-400 bg-amber-500/10" },
};

export default function RecentStudents({ master }: { master: any[] }) {
  // Most recent slot confirmations
  const recent = [...master]
    .filter(r => r.Date && r.Name)
    .sort((a, b) => String(b.Date).localeCompare(String(a.Date)))
    .slice(0, 12);

  return (
    <div className="glow-card rounded-xl p-6 animate-fade-in">
      <div className="mb-4">
        <h2 className="text-lg font-semibold">Latest paid students</h2>
        <p className="text-xs text-fg-muted mt-0.5">Most recent slot confirmations across all Forge programs</p>
      </div>
      <div className="space-y-2">
        {recent.map((s, i) => {
          const tag = PROGRAM_LABEL[s.Product] || { name: s.Product || "—", color: "text-fg-muted bg-fg-border" };
          const date = fmtDate(s.Date);
          return (
            <div key={i} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-fg-card transition-colors">
              <div className="flex items-center gap-3 min-w-0">
                <span className={`text-xs font-medium px-2 py-0.5 rounded ${tag.color} shrink-0`}>{tag.name}</span>
                <span className="text-xs text-fg-muted shrink-0">{s.Edition}</span>
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{s.Name}</div>
                  <div className="text-xs text-fg-muted truncate">{s.Email}</div>
                </div>
              </div>
              <div className="text-right shrink-0 ml-4">
                <div className="text-sm font-semibold">{inr(parseFloat(s["Booked Revenue"]) || 0)}</div>
                <div className="text-xs text-fg-muted">{date}</div>
              </div>
            </div>
          );
        })}
        {recent.length === 0 && (
          <div className="text-center text-fg-muted py-8 text-sm">No recent confirmations to display.</div>
        )}
      </div>
    </div>
  );
}
