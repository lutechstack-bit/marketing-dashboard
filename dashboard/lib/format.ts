// Indian-format currency + number helpers.

export function inr(n: number, opts: { compact?: boolean } = {}): string {
  if (!Number.isFinite(n)) return "—";
  if (opts.compact) {
    if (Math.abs(n) >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
    if (Math.abs(n) >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
    if (Math.abs(n) >= 1e3) return `₹${(n / 1e3).toFixed(1)} K`;
  }
  // Indian comma format: 1,23,45,678
  const parts = Math.round(n).toString().split("").reverse();
  let out = "";
  for (let i = 0; i < parts.length; i++) {
    if (i === 3 || (i > 3 && (i - 3) % 2 === 0)) out = "," + out;
    out = parts[i] + out;
  }
  return `₹${n < 0 ? "-" : ""}${out}`;
}

export function pct(n: number, decimals = 1): string {
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(decimals)}%`;
}

export function deltaPct(now: number, prev: number): number {
  if (!prev || !Number.isFinite(prev)) return 0;
  return ((now - prev) / Math.abs(prev)) * 100;
}

export function fmtInt(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("en-IN");
}

// Convert Excel/Sheets date serial (days since 1899-12-30) or ISO string to readable
export function fmtDate(v: any): string {
  if (!v) return "—";
  if (typeof v === "number" || /^\d+(\.\d+)?$/.test(String(v))) {
    const serial = parseFloat(String(v));
    const d = new Date(Math.round((serial - 25569) * 86400 * 1000));
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
    }
  }
  // ISO string
  const d = new Date(String(v).split(" ")[0]);
  if (!isNaN(d.getTime())) {
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  }
  return String(v).slice(0, 10);
}
