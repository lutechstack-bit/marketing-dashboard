// Earnings ledger logic — drives /admin/payouts, /leaderboard, and the
// "money in escrow" UX on the sales rep queue.
//
// State machine (per lead × rep):
//   locked    — slot confirmation paid (₹15k Forge / ₹8k Live)
//   unlocked  — balance/full payment received  (rep can claim, awaiting admin)
//   approved  — admin clicked Approve
//   paid_out  — admin marked as paid (cash transferred)
//   reverted  — refund detected, silent revert per founder choice
//
// All transitions write to earnings_audit for traceability.

import { supabase } from "./supabase";

export type EarningStatus = "locked" | "unlocked" | "approved" | "paid_out" | "reverted";

export type EarningRow = {
  id: string;
  lead_id: string | null;
  rep_id: string | null;
  product_code: string | null;
  edition_label: string | null;
  amount_inr: number;
  status: EarningStatus;
  locked_at: string | null;
  unlocked_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  paid_out_at: string | null;
  reverted_at: string | null;
  reverted_reason: string | null;
  trigger_slot_payment_id: string | null;
  trigger_balance_payment_id: string | null;
  notes: string | null;
  created_at: string;
};

export type RepAssignment = {
  id: string;
  rep_id: string;
  product_code: string;
  edition_match: string | null;
  edition_label: string | null;
  incentive_inr: number;
  active: boolean;
  effective_from: string | null;
  effective_to: string | null;
};

// ----------------------------------------------------------------
// Lookups
// ----------------------------------------------------------------

/** Find the active assignment for a (product, edition_answer). Picks edition-specific
 *  match before falling back to the catch-all (edition_match IS NULL).
 *  Returns { rep_id, incentive_inr, edition_label } or null. */
export async function lookupAssignment(opts: {
  productCode: string;
  editionAnswer?: string | null;
  asOf?: Date;
}): Promise<{ rep_id: string; incentive_inr: number; edition_label: string | null } | null> {
  const { data, error } = await supabase
    .from("rep_assignments")
    .select("id,rep_id,product_code,edition_match,edition_label,incentive_inr,effective_from,effective_to,active")
    .eq("product_code", opts.productCode)
    .eq("active", true);
  if (error || !data || data.length === 0) return null;

  // Filter by effective dates
  const asOfStr = (opts.asOf || new Date()).toISOString().slice(0, 10);
  const valid = data.filter(a =>
    (!a.effective_from || a.effective_from <= asOfStr) &&
    (!a.effective_to   || a.effective_to   >= asOfStr)
  );

  // Edition-specific match first
  if (opts.editionAnswer) {
    for (const a of valid) {
      if (a.edition_match) {
        try {
          if (new RegExp(a.edition_match, "i").test(opts.editionAnswer)) {
            return { rep_id: a.rep_id, incentive_inr: Number(a.incentive_inr), edition_label: a.edition_label };
          }
        } catch { /* invalid regex — skip */ }
      }
    }
  }
  // Fall back to catch-all (edition_match IS NULL)
  const catchAll = valid.find(a => !a.edition_match);
  if (catchAll) {
    return { rep_id: catchAll.rep_id, incentive_inr: Number(catchAll.incentive_inr), edition_label: catchAll.edition_label };
  }
  return null;
}

/** Look up the lead's edition answer from form_submissions. Returns first non-empty match. */
export async function getLeadEditionAnswer(leadId: string): Promise<string | null> {
  const { data: subs } = await supabase
    .from("form_submissions")
    .select("responses")
    .eq("lead_id", leadId)
    .order("submitted_at", { ascending: false });
  for (const s of (subs || [])) {
    const r = s.responses as Record<string, any> | null;
    if (!r) continue;
    for (const k of Object.keys(r)) {
      if (/are you available|edition|when can you/i.test(k)) {
        const v = r[k];
        const str = Array.isArray(v) ? v.join(" ") : (v ? String(v) : "");
        if (str.trim()) return str;
      }
    }
  }
  return null;
}

// ----------------------------------------------------------------
// State transitions — all write to earnings_audit
// ----------------------------------------------------------------

async function logAudit(opts: {
  earning_id: string;
  from_status: EarningStatus | null;
  to_status: EarningStatus;
  changed_by?: string | null;   // rep id or null = system
  reason?: string;
  payload?: any;
}) {
  await supabase.from("earnings_audit").insert({
    earning_id: opts.earning_id,
    from_status: opts.from_status,
    to_status: opts.to_status,
    changed_by: opts.changed_by || null,
    reason: opts.reason || null,
    payload: opts.payload || null,
  });
}

/** Create a 'locked' earning when slot confirmation is paid. Idempotent — if an
 *  earning already exists for (lead_id, rep_id, status='locked'), returns it. */
export async function lockEarning(opts: {
  lead_id: string;
  rep_id: string;
  product_code: string;
  edition_label: string | null;
  amount_inr: number;
  slot_payment_id: string;
  notes?: string;
}): Promise<EarningRow | null> {
  // Idempotency: dedup by trigger_slot_payment_id
  const { data: existing } = await supabase
    .from("incentive_earnings")
    .select("*")
    .eq("trigger_slot_payment_id", opts.slot_payment_id)
    .limit(1);
  if (existing && existing.length > 0) return existing[0] as EarningRow;

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("incentive_earnings")
    .insert({
      lead_id: opts.lead_id,
      rep_id: opts.rep_id,
      product_code: opts.product_code,
      edition_label: opts.edition_label,
      amount_inr: opts.amount_inr,
      status: "locked",
      locked_at: now,
      trigger_slot_payment_id: opts.slot_payment_id,
      notes: opts.notes || null,
    })
    .select()
    .single();
  if (error || !data) {
    console.error("[earnings.lockEarning] error:", error?.message);
    return null;
  }
  await logAudit({
    earning_id: data.id, from_status: null, to_status: "locked",
    reason: "Slot confirmation payment captured",
    payload: { slot_payment_id: opts.slot_payment_id },
  });
  return data as EarningRow;
}

/**
 * MANUAL attribution by an admin/founder. Same shape as a webhook-driven
 * lock except there's no Razorpay slot_payment_id — the trigger is a human
 * decision. Idempotency key falls back to a synthetic one
 * "manual_<lead_id>_<rep_id>" so admins can't accidentally double-attribute
 * the same lead to the same rep.
 *
 * Used when:
 *   · Lead came in BEFORE the earnings system existed and needs a back-fill
 *   · Lead converted organically (no rep call) but rep deserves credit
 *     because they pre-warmed the conversation outside the system
 *   · Any other one-off attribution case
 */
export async function manualLockEarning(opts: {
  lead_id: string;
  rep_id: string;
  product_code: string;
  edition_label: string | null;
  amount_inr: number;
  attributed_by: string; // admin/founder rep_id
  notes?: string;
}): Promise<EarningRow | null> {
  const dedupKey = `manual_${opts.lead_id}_${opts.rep_id}`;
  const { data: existing } = await supabase
    .from("incentive_earnings")
    .select("*")
    .eq("trigger_slot_payment_id", dedupKey)
    .limit(1);
  if (existing && existing.length > 0) return existing[0] as EarningRow;

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("incentive_earnings")
    .insert({
      lead_id: opts.lead_id,
      rep_id: opts.rep_id,
      product_code: opts.product_code,
      edition_label: opts.edition_label,
      amount_inr: opts.amount_inr,
      status: "locked",
      locked_at: now,
      trigger_slot_payment_id: dedupKey,
      notes: opts.notes ? `Manual: ${opts.notes}` : "Manual attribution by admin",
    })
    .select()
    .single();
  if (error || !data) {
    console.error("[earnings.manualLockEarning] error:", error?.message);
    return null;
  }
  await logAudit({
    earning_id: data.id, from_status: null, to_status: "locked",
    changed_by: opts.attributed_by,
    reason: `Manual attribution by admin${opts.notes ? `: ${opts.notes}` : ""}`,
    payload: { manual: true, attributed_by: opts.attributed_by },
  });

  // ALSO bump the lead's funnel_stage so they leave the Abandoned bucket.
  // A manual attribution means: "I'm crediting this rep because this lead
  // converted (paid app fee)." So the stage should reflect that. Only
  // promote, never downgrade — if the lead is already at accepted/balance_paid
  // we leave it.
  try {
    const { data: lead } = await supabase.from("leads")
      .select("funnel_stage").eq("id", opts.lead_id).maybeSingle();
    const currentStage = lead?.funnel_stage;
    const PROMOTE_FROM = ["form_partial", "form_submitted"];
    if (currentStage && PROMOTE_FROM.includes(currentStage)) {
      await supabase.from("leads")
        .update({ funnel_stage: "app_fee_paid", last_activity: now })
        .eq("id", opts.lead_id);
    }
  } catch (e: any) {
    console.error("[manualLockEarning] funnel_stage promote failed:", e?.message);
    // Non-fatal — earning is already created.
  }

  // Bust caches so the rep sees their new locked earning + the lead leaves
  // the Abandoned bucket on next /queue load.
  try {
    const { revalidateTag } = await import("next/cache");
    revalidateTag("leads");
  } catch { /* not in app context */ }

  return data as EarningRow;
}

/** Move locked earning to 'unlocked' on balance payment. Looks up by lead_id. */
export async function unlockEarningForLead(opts: {
  lead_id: string;
  balance_payment_id: string;
}): Promise<EarningRow | null> {
  const { data: earnings } = await supabase
    .from("incentive_earnings")
    .select("*")
    .eq("lead_id", opts.lead_id)
    .eq("status", "locked")
    .order("locked_at", { ascending: false })
    .limit(1);
  if (!earnings || earnings.length === 0) {
    console.warn(`[earnings.unlock] no locked earning found for lead ${opts.lead_id}`);
    return null;
  }
  const e = earnings[0];

  const { data, error } = await supabase
    .from("incentive_earnings")
    .update({
      status: "unlocked",
      unlocked_at: new Date().toISOString(),
      trigger_balance_payment_id: opts.balance_payment_id,
    })
    .eq("id", e.id)
    .select()
    .single();
  if (error || !data) return null;

  await logAudit({
    earning_id: data.id, from_status: "locked", to_status: "unlocked",
    reason: "Balance payment captured",
    payload: { balance_payment_id: opts.balance_payment_id },
  });
  return data as EarningRow;
}

/** Revert an earning silently (refund). Records audit. */
export async function revertEarning(opts: {
  earning_id?: string;
  payment_id?: string;        // alternatively, revert by matching the trigger payment
  reason: string;
}): Promise<EarningRow | null> {
  let earning: any = null;
  if (opts.earning_id) {
    const r = await supabase.from("incentive_earnings").select("*").eq("id", opts.earning_id).single();
    earning = r.data;
  } else if (opts.payment_id) {
    const r = await supabase.from("incentive_earnings").select("*")
      .or(`trigger_slot_payment_id.eq.${opts.payment_id},trigger_balance_payment_id.eq.${opts.payment_id}`)
      .limit(1);
    earning = r.data?.[0];
  }
  if (!earning) return null;

  const { data, error } = await supabase
    .from("incentive_earnings")
    .update({
      status: "reverted",
      reverted_at: new Date().toISOString(),
      reverted_reason: opts.reason,
    })
    .eq("id", earning.id)
    .select()
    .single();
  if (error) return null;

  await logAudit({
    earning_id: earning.id, from_status: earning.status, to_status: "reverted",
    reason: opts.reason,
  });
  return data as EarningRow;
}

/** Admin approves a single earning. */
export async function approveEarning(opts: { earning_id: string; admin_id: string }): Promise<EarningRow | null> {
  const { data: existing } = await supabase.from("incentive_earnings").select("*").eq("id", opts.earning_id).single();
  if (!existing || existing.status !== "unlocked") return null;

  const { data, error } = await supabase
    .from("incentive_earnings")
    .update({
      status: "approved",
      approved_at: new Date().toISOString(),
      approved_by: opts.admin_id,
    })
    .eq("id", opts.earning_id)
    .eq("status", "unlocked")
    .select()
    .single();
  if (error) return null;
  await logAudit({ earning_id: opts.earning_id, from_status: "unlocked", to_status: "approved", changed_by: opts.admin_id });
  return data as EarningRow;
}

/** Admin marks an earning as paid out (cash transferred). */
export async function markPaidOut(opts: { earning_id: string; admin_id: string }): Promise<EarningRow | null> {
  const { data, error } = await supabase
    .from("incentive_earnings")
    .update({
      status: "paid_out",
      paid_out_at: new Date().toISOString(),
    })
    .eq("id", opts.earning_id)
    .in("status", ["unlocked", "approved"])
    .select()
    .single();
  if (error) return null;
  await logAudit({ earning_id: opts.earning_id, from_status: "approved", to_status: "paid_out", changed_by: opts.admin_id });
  return data as EarningRow;
}

// ----------------------------------------------------------------
// Aggregations for /leaderboard and EarningsHeader
// ----------------------------------------------------------------

export type EarningTotals = {
  rep_id: string;
  locked_count: number;     locked_amount: number;
  unlocked_count: number;   unlocked_amount: number;
  approved_count: number;   approved_amount: number;
  paid_out_count: number;   paid_out_amount: number;
  reverted_count: number;   reverted_amount: number;
};

/** Returns per-rep totals across the given period (or all-time if no period). */
export async function getEarningsTotals(opts?: { rep_id?: string; from?: Date; to?: Date }): Promise<EarningTotals[]> {
  let q = supabase.from("incentive_earnings").select("rep_id,status,amount_inr,locked_at,unlocked_at,approved_at,paid_out_at");
  if (opts?.rep_id) q = q.eq("rep_id", opts.rep_id);
  // Use locked_at as the canonical "earned in" date — when the rep first qualified
  if (opts?.from) q = q.gte("locked_at", opts.from.toISOString());
  if (opts?.to)   q = q.lte("locked_at", opts.to.toISOString());

  const { data, error } = await q;
  if (error || !data) return [];

  const map: Record<string, EarningTotals> = {};
  for (const e of data) {
    const r = e.rep_id || "_orphan";
    map[r] ||= {
      rep_id: r,
      locked_count: 0, locked_amount: 0,
      unlocked_count: 0, unlocked_amount: 0,
      approved_count: 0, approved_amount: 0,
      paid_out_count: 0, paid_out_amount: 0,
      reverted_count: 0, reverted_amount: 0,
    };
    const amt = Number(e.amount_inr) || 0;
    if (e.status === "locked")    { map[r].locked_count++;    map[r].locked_amount    += amt; }
    if (e.status === "unlocked")  { map[r].unlocked_count++;  map[r].unlocked_amount  += amt; }
    if (e.status === "approved")  { map[r].approved_count++;  map[r].approved_amount  += amt; }
    if (e.status === "paid_out")  { map[r].paid_out_count++;  map[r].paid_out_amount  += amt; }
    if (e.status === "reverted")  { map[r].reverted_count++;  map[r].reverted_amount  += amt; }
  }
  return Object.values(map);
}

/** Lookup the (potential) earning amount for a lead — used for "if converted: ₹X" display
 *  on each lead card before any payment has happened. Reads from rep_assignments. */
export async function getPotentialEarning(opts: {
  productCode: string;
  editionAnswer?: string | null;
}): Promise<{ rep_id: string; amount: number; edition_label: string | null } | null> {
  const a = await lookupAssignment(opts);
  if (!a) return null;
  return { rep_id: a.rep_id, amount: a.incentive_inr, edition_label: a.edition_label };
}
