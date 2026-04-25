// AI-style "why hot" reasoner + talking-point generator.
// Pure heuristics for v1 — LLM augmentation lives in a future phase.

import type { LeadRow, FormSubmissionRow } from "./supabase";

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

  if (stage === "accepted") {
    if (ago !== null && ago < 24) {
      return `Paid the application fee ${fmtAgo(ago)} ago. Highest-intent moment — call before they cool off.`;
    }
    return `Paid app fee ${ago !== null ? fmtAgo(ago) + " ago" : "previously"} but hasn't confirmed the slot. Rescue zone — call now.`;
  }

  if (stage === "form_submitted" && lead.score >= 75) {
    return `Strong fit (score ${lead.score}). Submitted the full application ${ago !== null ? fmtAgo(ago) + " ago" : "recently"}. High likelihood to convert with a personal call.`;
  }

  if (stage === "form_submitted" && ago !== null && ago < 4) {
    return `Form submitted ${fmtAgo(ago)} ago — they're still in the buying window. Reach out while top-of-mind.`;
  }

  if (stage === "form_submitted") {
    return `Submitted the application ${ago !== null ? fmtAgo(ago) + " ago" : "previously"}. Score ${lead.score}/100 — worth a structured call to qualify.`;
  }

  if (stage === "app_fee_paid") {
    return `App fee captured. Verify they got the next-step email and book the interview.`;
  }

  if (stage === "form_partial") {
    return `Started the form but didn't finish. A short message can recover it — focus on what made them start.`;
  }

  if (stage === "confirmed") {
    return `Already confirmed. Move into program ops — onboarding, payment plan, prep materials.`;
  }

  if (stage === "balance_paid") {
    return `Paid in full. Treat as a current student — no further sales push.`;
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

  if (lead.funnel_stage === "accepted") {
    out.push("Confirm they want to lock in the slot — payment of ₹15k holds it.");
    out.push("If they hesitate on price, surface the value: alumni network, edition location, faculty.");
  }
  if (lead.funnel_stage === "form_submitted" && lead.score >= 50) {
    out.push("Walk them through what happens after they pay the application fee.");
    out.push("Ask what's making them consider this program right now — captures urgency.");
  }
  if (lead.funnel_stage === "form_partial") {
    out.push("Open with: \"Saw you started filling the form for {program} — anything we can clarify?\"");
  }

  // Mine the form responses for personalization
  const responses: Record<string, any> = {};
  for (const s of submissions) if (s.responses) Object.assign(responses, s.responses);

  // Why-this-program answer
  const whyKey = Object.keys(responses).find(k => /why/i.test(k) && /(forge|program|join|interest|apply)/i.test(k));
  if (whyKey && responses[whyKey]) {
    const why = String(responses[whyKey]).slice(0, 140).trim();
    if (why.length > 20) {
      out.push(`Reference their "why" answer: "${why}${why.length >= 140 ? "…" : ""}"`);
    }
  }

  // Profession
  const profKey = Object.keys(responses).find(k => /profession|occupation|currently doing|what do you do/i.test(k));
  if (profKey && responses[profKey]) {
    const p = Array.isArray(responses[profKey]) ? responses[profKey].join(", ") : String(responses[profKey]);
    if (p.length < 80) out.push(`Background: ${p} — tie program outcomes to that field.`);
  }

  // Engagement hint
  if (bd.why_long || bd.why_medium) {
    out.push("They wrote a substantive answer — they've thought about this. Match that energy.");
  }
  if (bd.recency_24h) {
    out.push("They were active in the last 24h — strike now, momentum is on your side.");
  }
  if (bd.age_25_40) {
    out.push("Age 25–40 (ICP fit) — frame around career inflection, not student vibes.");
  }

  // Default fallback
  if (out.length === 0) {
    out.push("Open with a question, not a pitch — ask what they're looking for from the program.");
    out.push("Listen for objections; price + time are the two big ones for Forge.");
  }

  return out.slice(0, 4);
}
