// Status enum used by the inline-editable status dropdown on /queue and
// /leads/[id]. Designed to swap 1:1 with TeleCRM's status list once the
// canonical list arrives — keep this file as the only place that defines them.
//
// When TeleCRM API access is wired, /api/activities will additionally POST
// the same status to TeleCRM after writing to Supabase.

export type StatusId =
  | "new"
  | "called_no_answer"
  | "called_dnp"
  | "called_interested"
  | "called_not_interested"
  | "called_budget_issue"
  | "called_wants_more_info"
  | "scheduled_followup"
  | "application_fee_paid"
  | "interview_booked"
  | "confirmed"
  | "lost";

export type StatusDef = {
  id: StatusId;
  label: string;
  // Tone for visual badge
  tone: "neutral" | "info" | "warning" | "success" | "danger";
  // Optional: a status change implies a funnel-stage change
  implies_stage?: string;
};

export const STATUSES: StatusDef[] = [
  { id: "new",                    label: "New",                       tone: "neutral" },
  { id: "called_no_answer",       label: "Called · No answer",        tone: "warning" },
  { id: "called_dnp",             label: "Called · DNP",              tone: "warning" },
  { id: "called_interested",      label: "Called · Interested",       tone: "info" },
  { id: "called_not_interested",  label: "Called · Not interested",   tone: "danger" },
  { id: "called_budget_issue",    label: "Called · Budget issue",     tone: "warning" },
  { id: "called_wants_more_info", label: "Called · Wants more info",  tone: "info" },
  { id: "scheduled_followup",     label: "Follow-up scheduled",       tone: "info" },
  { id: "application_fee_paid",   label: "App fee paid",              tone: "success", implies_stage: "accepted" },
  { id: "interview_booked",       label: "Interview booked",          tone: "success", implies_stage: "accepted" },
  { id: "confirmed",              label: "Confirmed (₹15k)",          tone: "success", implies_stage: "confirmed" },
  { id: "lost",                   label: "Lost",                      tone: "danger",  implies_stage: "lost" },
];

export const STATUS_BY_ID: Record<string, StatusDef> = Object.fromEntries(
  STATUSES.map(s => [s.id, s])
);

export const STATUS_TONE_CLS: Record<StatusDef["tone"], string> = {
  neutral: "bg-slate-100 text-slate-700 ring-1 ring-slate-200",
  info:    "bg-cyan-50 text-cyan-700 ring-1 ring-cyan-200",
  warning: "bg-amber-50 text-amber-800 ring-1 ring-amber-200",
  success: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  danger:  "bg-rose-50 text-rose-700 ring-1 ring-rose-200",
};

/** Map a raw activity action (as stored in lead_activities.action) to a StatusId.
 *  Handles legacy action names too. */
export function actionToStatus(action: string | null | undefined): StatusId {
  if (!action) return "new";
  if (STATUS_BY_ID[action]) return action as StatusId;
  // Legacy mapping (existing rows in lead_activities):
  const legacy: Record<string, StatusId> = {
    called:           "called_no_answer", // ambiguous old action — treat as called
    no_answer:        "called_no_answer",
    busy:             "called_no_answer",
    messaged:         "called_wants_more_info",
    interested:       "called_interested",
    objection:        "called_not_interested",
    converted:        "confirmed",
    note:             "new",  // notes don't change status
  };
  return legacy[action] || "new";
}
