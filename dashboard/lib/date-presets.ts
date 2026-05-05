// Date range preset library — used by /queue, /leads, /insights, anywhere.
//
// Indian Financial Year = April 1 → March 31. So "This FY" in May 2026 means
// Apr 1 2026 → Mar 31 2027. Calendar quarters are used for "This quarter"
// because that's the most common founder mental model; switch to FY quarters
// later if needed.

export type DateRange = {
  start: Date | null;   // inclusive — null = unbounded (all time)
  end:   Date | null;   // inclusive — null = "now"
  label: string;
  id:    string;
};

const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const endOfDay   = (d: Date) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };
const addDays    = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const addMonths  = (d: Date, n: number) => { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; };

/** Sunday=0, Monday=1, ... Tuesday=2 → days since the most recent Monday. */
const daysSinceMonday = (d: Date) => (d.getDay() + 6) % 7;

/** Indian Financial Year start (Apr 1) for the current date. */
function fyStart(d: Date): Date {
  const y = d.getFullYear();
  const m = d.getMonth(); // 0=Jan, 3=Apr
  return startOfDay(new Date(m >= 3 ? y : y - 1, 3, 1));
}
function fyEnd(d: Date): Date {
  const start = fyStart(d);
  return endOfDay(new Date(start.getFullYear() + 1, 2, 31)); // Mar 31 next year
}

/** Returns all the preset options. Each preset is computed relative to `now`. */
export function buildPresets(now: Date = new Date()): DateRange[] {
  const today = startOfDay(now);
  const yesterday = addDays(today, -1);

  // This week = Monday → today (inclusive)
  const thisWeekStart = addDays(today, -daysSinceMonday(today));
  const lastWeekStart = addDays(thisWeekStart, -7);
  const lastWeekEnd   = addDays(thisWeekStart, -1);

  // This month
  const thisMonthStart = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
  const lastMonthStart = startOfDay(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const lastMonthEnd   = endOfDay(new Date(now.getFullYear(), now.getMonth(), 0));

  // This quarter (calendar)
  const qIdx = Math.floor(now.getMonth() / 3);
  const thisQStart = startOfDay(new Date(now.getFullYear(), qIdx * 3, 1));
  const lastQStart = startOfDay(new Date(now.getFullYear(), (qIdx - 1) * 3, 1));
  const lastQEnd   = endOfDay(new Date(now.getFullYear(), qIdx * 3, 0));

  // FY (India: Apr–Mar)
  const thisFyStart = fyStart(now);
  const thisFyEnd   = fyEnd(now);
  const lastFyStart = startOfDay(new Date(thisFyStart.getFullYear() - 1, 3, 1));
  const lastFyEnd   = endOfDay(new Date(thisFyStart.getFullYear(), 2, 31));

  return [
    { id: "today",       label: "Today",                 start: today,                       end: endOfDay(now) },
    { id: "yesterday",   label: "Yesterday",             start: yesterday,                   end: endOfDay(yesterday) },
    { id: "today_yest",  label: "Today + yesterday",     start: yesterday,                   end: endOfDay(now) },
    { id: "this_week",   label: "This week",             start: thisWeekStart,               end: endOfDay(now) },
    { id: "last_week",   label: "Last week",             start: lastWeekStart,               end: lastWeekEnd },
    { id: "last_7d",     label: "Last 7 days",           start: addDays(today, -6),          end: endOfDay(now) },
    { id: "this_month",  label: "This month",            start: thisMonthStart,              end: endOfDay(now) },
    { id: "last_month",  label: "Last month",            start: lastMonthStart,              end: lastMonthEnd },
    { id: "last_30d",    label: "Last 30 days",          start: addDays(today, -29),         end: endOfDay(now) },
    { id: "this_q",      label: "This quarter",          start: thisQStart,                  end: endOfDay(now) },
    { id: "last_q",      label: "Last quarter",          start: lastQStart,                  end: lastQEnd },
    { id: "last_90d",    label: "Last 90 days",          start: addDays(today, -89),         end: endOfDay(now) },
    { id: "this_fy",     label: "This FY",               start: thisFyStart,                 end: thisFyEnd },
    { id: "last_fy",     label: "Last FY",               start: lastFyStart,                 end: lastFyEnd },
    { id: "all",         label: "All time",              start: null,                        end: null },
  ];
}

/** Format a range for display: "May 20 – May 26" or "May 6, 2026" or "All time". */
export function formatRange(r: DateRange): string {
  if (!r.start && !r.end) return "All time";
  if (r.start && r.end && sameDay(r.start, r.end)) {
    return r.start.toLocaleDateString("en-IN", { month: "short", day: "numeric", year: "numeric" });
  }
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const s = r.start ? r.start.toLocaleDateString("en-IN", opts) : "…";
  const e = r.end   ? r.end.toLocaleDateString("en-IN", opts)   : "now";
  return `${s} – ${e}`;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Apply a date range filter to anything that has a date field. Inclusive. */
export function inRange(date: string | Date | null | undefined, range: DateRange): boolean {
  if (!date) return false;
  const t = typeof date === "string" ? new Date(date).getTime() : date.getTime();
  if (!Number.isFinite(t)) return false;
  if (range.start && t < range.start.getTime()) return false;
  if (range.end   && t > range.end.getTime())   return false;
  return true;
}

/** Empty range (no filter applied) */
export const ALL_TIME: DateRange = { start: null, end: null, label: "All time", id: "all" };
