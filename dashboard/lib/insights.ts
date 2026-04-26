// Heuristic "why hot" + talking-point generator. Pure rules for v1.
// Bucket framing matches /queue: A = completed form, no app fee
//                                  B = paid app fee, no interview booked
//                                  C = partials

import type { LeadRow, FormSubmissionRow } from "./supabase";

// App-fee amounts per program (in INR) — pulled from credentials doc
const APP_FEE_INR: Record<string, number> = {
  FFM: 800, FW: 600, FC: 700, FAI: 900,
  BFP: 400, VE: 400, L3C: 400,
};

function hoursAgo(iso?: string | null): number | null {
  if (!iso) return null;
  return (Date.now() - new Date(iso).getTime()) / 3600_000;
}

function fmtAgo(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 24) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

/** One-sentence reason this lead deserves attention right now. */
export function whyHotReason(lead: LeadRow): string {
  const stage = lead.funnel_stage || "form_partial";
  const ago = hoursAgo(lead.last_activity);
  const fee = lead.program ? APP_FEE_INR[lead.program] : null;

  // Bucket A: completed form, didn't pay app fee
  if (stage === "form_submitted") {
    if (lead.score >= 75) {
      return `Strong fit (score ${lead.score}). Filled the full application ${ago !== null ? fmtAgo(ago) + " ago" : "recently"} but didn't pay the ${fee ? "₹" + fee.toLocaleString("en-IN") + " " : ""}app fee. Push them across the line.`;
    }
    if (ago !== null && ago < 4) {
      return `Form submitted ${fmtAgo(ago)} ago — still in the buying window. Hasn't paid the app fee yet; call now while they're warm.`;
    }
    return `Completed the application ${ago !== null ? fmtAgo(ago) + " ago" : "previously"} but skipped the app fee step. Score ${lead.score}/100 — worth a call to walk them through the payment.`;
  }

  // Bucket B: paid app fee, didn't book Calendly
  if (stage === "accepted" || stage === "app_fee_paid") {
    if (ago !== null && ago < 24) {
      return `Paid the application fee ${fmtAgo(ago)} ago. Next step is the Calendly interview booking — call to walk them through it before they cool off.`;
    }
    return `Paid app fee ${ago !== null ? fmtAgo(ago) + " ago" : "previously"} but hasn't booked the interview. Drop-off risk is highest here — book the slot for them on the call.`;
  }

  // Bucket C: partials
  if (stage === "form_partial") {
    return `Started the application but didn't finish. A short WhatsApp message often recovers them — open with what they got partway through.`;
  }

  // Downstream stages — not really queue material, but render gracefully
  if (stage === "confirmed") {
    return `Already confirmed (paid the ₹15k slot). Move into program ops — onboarding and balance payment.`;
  }
  if (stage === "balance_paid") {
    return `Paid in full. Treat as a current student — no further sales push needed.`;
  }
  if (stage === "lost") {
    return `Marked lost previously. Skip unless something materially changed.`;
  }

  return `Score ${lead.score}/100. Review their form to decide priority.`;
}

/** Up to 4 short, actionable talking points for the rep on the call. */
export function suggestTalkingPoints(lead: LeadRow, submissions: FormSubmissionRow[] = []): string[] {
  const out: string[] = [];
  const bd = lead.score_breakdown || {};
  const stage = lead.funnel_stage || "form_partial";
  const fee = lead.program ? APP_FEE_INR[lead.program] : null;

  // Bucket-specific opening lines
  if (stage === "form_submitted") {
    out.push(`Walk them through the app fee step — ${fee ? `it's only ₹${fee.toLocaleString("en-IN")}` : "it's a small amount"}, most drop-off happens right here.`);
    out.push("Ask: \"What would help you take the next step today?\" — surfaces the real objection.");
  }
  if (stage === "accepted" || stage === "app_fee_paid") {
    out.push("Send the Calendly link in WhatsApp while you're on the phone — book the slot together so they can't forget.");
    out.push("If they hesitate on a time, offer 2–3 specific slots in the next 48h instead of leaving it open.");
  }
  if (stage === "form_partial") {
    out.push("Open with: \"Saw you started the application — anything we can clarify before you finish?\"");
  }

  // Personalization from form responses
  const responses: Record<string, any> = {};
  for (const s of submissions) if (s.responses) Object.assign(responses, s.responses);

  const whyKey = Object.keys(responses).find(k => /why/i.test(k) && /(forge|program|join|interest|apply)/i.test(k));
  if (whyKey && responses[whyKey]) {
    const why = String(responses[whyKey]).slice(0, 140).trim();
    if (why.length > 20) {
      out.push(`Reference their "why" answer: "${why}${why.length >= 140 ? "…" : ""}"`);
    }
  }

  const profKey = Object.keys(responses).find(k => /profession|occupation|currently doing|what do you do/i.test(k));
  if (profKey && responses[profKey]) {
    const p = Array.isArray(responses[profKey]) ? responses[profKey].join(", ") : String(responses[profKey]);
    if (p.length < 80) out.push(`Background: ${p} — tie program outcomes to that field.`);
  }

  if (bd.why_long || bd.why_medium) {
    out.push("They wrote a substantive answer — they've thought about this. Match that energy.");
  }
  if (bd.recency_24h) {
    out.push("Active in the last 24h — strike now, momentum is on your side.");
  }
  if (bd.age_25_40) {
    out.push("Age 25–40 (ICP fit) — frame around career inflection, not student vibes.");
  }

  // Fallback
  if (out.length === 0) {
    out.push("Open with a question, not a pitch — ask what they're looking for from the program.");
    out.push("Listen for objections; price + time are the two big ones.");
  }

  return out.slice(0, 4);
}
