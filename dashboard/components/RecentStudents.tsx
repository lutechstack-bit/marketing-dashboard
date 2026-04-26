import { inr, fmtDate } from "@/lib/format";

const PROGRAM_LABEL: Record<string, { name: string; color: string }> = {
  FFM: { name: "Filmmaking", color: "text-yellow-800 bg-yellow-50 ring-1 ring-yellow-200" },
  FW:  { name: "Writing",    color: "text-sky-700 bg-sky-50 ring-1 ring-sky-200" },
  FC:  { name: "Creators",   color: "text-red-700 bg-red-50 ring-1 ring-red-200" },
  FAI: { name: "AI",         color: "text-indigo-800 bg-indigo-50 ring-1 ring-indigo-200" },
};

export default function RecentStudents({ master }: { master: any[] }) {
  const recent = [...master]
    .filter(r => r.Date && r.Name)
    .sort((a, b) => String(b.Date).localeCompare(String(a.Date)))
    .slice(0, 12);

  return (
    <div className="surface-card p-6 animate-fade-in">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-fg-text">Latest paid students</h2>
        <p className="text-xs text-fg-muted mt-0.5">Most recent slot confirmations across Forge programs</p>
      </div>
      <div className="space-y-1.5">
        {recent.map((s, i) => {
          const tag = PROGRAM_LABEL[s.Product] || { name: s.Product || "—", color: "text-fg-muted bg-fg-surface ring-1 ring-fg-border" };
          const date = fmtDate(s.Date);
          return (
            <div key={i} className="flex items-center justify-between py-2 px-3 rounded-lg row-hover transition-colors">
              <div className="flex items-center gap-3 min-w-0">
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded ${tag.color} shrink-0`}>{tag.name}</span>
                <span className="text-xs text-fg-muted shrink-0">{s.Edition}</span>
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate text-fg-text">{s.Name}</div>
                  <div className="text-xs text-fg-muted truncate">{s.Email}</div>
                </div>
              </div>
              <div className="text-right shrink-0 ml-4">
                <div className="text-sm font-semibold text-fg-text tabular-nums">{inr(parseFloat(s["Booked Revenue"]) || 0)}</div>
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
