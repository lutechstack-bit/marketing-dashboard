// Earnings actions for admins: approve, mark paid, batch operations.
// Auth: must be logged-in admin. Middleware already protected by /admin route prefix
// for route gating — here we add an explicit role check too.

import { NextResponse } from "next/server";
import { getCurrentRep, createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { approveEarning, markPaidOut, manualLockEarning } from "@/lib/earnings";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const rep = await getCurrentRep();
  if (!rep) return { error: "not authenticated" as const };
  if (rep.role !== "admin" && rep.role !== "founder") return { error: "not admin" as const };
  return { rep };
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { action, earning_id, earning_ids } = body || {};
  const adminId = auth.rep.id;

  if (action === "approve") {
    if (!earning_id) return NextResponse.json({ error: "earning_id required" }, { status: 400 });
    const result = await approveEarning({ earning_id, admin_id: adminId });
    return NextResponse.json({ ok: !!result, earning: result });
  }

  if (action === "approve_batch") {
    if (!Array.isArray(earning_ids) || earning_ids.length === 0) {
      return NextResponse.json({ error: "earning_ids array required" }, { status: 400 });
    }
    const results = await Promise.all(earning_ids.map(id => approveEarning({ earning_id: id, admin_id: adminId })));
    return NextResponse.json({
      ok: true,
      approved: results.filter(Boolean).length,
      failed: results.filter(r => !r).length,
    });
  }

  if (action === "mark_paid_out") {
    if (!earning_id) return NextResponse.json({ error: "earning_id required" }, { status: 400 });
    const result = await markPaidOut({ earning_id, admin_id: adminId });
    return NextResponse.json({ ok: !!result, earning: result });
  }

  if (action === "mark_paid_out_batch") {
    if (!Array.isArray(earning_ids) || earning_ids.length === 0) {
      return NextResponse.json({ error: "earning_ids array required" }, { status: 400 });
    }
    const results = await Promise.all(earning_ids.map(id => markPaidOut({ earning_id: id, admin_id: adminId })));
    return NextResponse.json({
      ok: true,
      paid_out: results.filter(Boolean).length,
      failed: results.filter(r => !r).length,
    });
  }

  // Update a lead — can do any combination of:
  //   1. Attribute a manual incentive to a rep (creates a 'locked' earning)
  //   2. Set the lead's funnel_stage explicitly
  // Both are independent and optional, but at least one must be provided.
  if (action === "attribute_manual" || action === "update_lead") {
    const { lead_id, rep_id, product_code, edition_label, amount_inr, notes, set_stage,
            conversion_date, initial_status } = body || {};
    if (!lead_id) return NextResponse.json({ error: "lead_id required" }, { status: 400 });

    const VALID_STAGES = [
      "form_partial", "form_submitted", "app_fee_paid",
      "accepted", "confirmed", "balance_paid", "attended", "lost",
    ];
    const wantStage = set_stage && VALID_STAGES.includes(set_stage) ? set_stage : null;
    const wantEarning = !!(rep_id && product_code && amount_inr);
    if (!wantStage && !wantEarning) {
      return NextResponse.json({
        error: "Provide either set_stage and/or (rep_id + product_code + amount_inr).",
      }, { status: 400 });
    }

    let earning: any = null;
    if (wantEarning) {
      const amt = Number(amount_inr);
      if (!Number.isFinite(amt) || amt <= 0) {
        return NextResponse.json({ error: "amount_inr must be > 0" }, { status: 400 });
      }
      // Validate optional date — must parse and be in the past or today.
      let convDate: string | undefined;
      if (conversion_date) {
        const parsed = new Date(conversion_date);
        if (isNaN(parsed.getTime())) {
          return NextResponse.json({ error: "conversion_date is invalid" }, { status: 400 });
        }
        if (parsed.getTime() > Date.now() + 86400_000) {
          return NextResponse.json({ error: "conversion_date can't be in the future" }, { status: 400 });
        }
        convDate = parsed.toISOString();
      }
      // Validate optional status
      const validStatuses = ["locked", "unlocked", "approved"];
      const status = initial_status && validStatuses.includes(initial_status) ? initial_status : undefined;

      earning = await manualLockEarning({
        lead_id,
        rep_id,
        product_code,
        edition_label: edition_label || null,
        amount_inr: amt,
        attributed_by: adminId,
        notes: notes || null,
        conversion_date: convDate,
        initial_status: status as any,
      });
      if (!earning) return NextResponse.json({ error: "failed to create earning" }, { status: 500 });
    }

    // If admin explicitly set a stage, override whatever manualLockEarning
    // promoted to. (The earning helper auto-promotes form_*/partial → app_fee_paid;
    // the explicit stage takes precedence so admins can move leads to any stage.)
    if (wantStage) {
      const { error: stageErr } = await supabase.from("leads").update({
        funnel_stage: wantStage,
        last_activity: new Date().toISOString(),
      }).eq("id", lead_id);
      if (stageErr) {
        return NextResponse.json({
          error: `stage update failed: ${stageErr.message}`,
          earning_created: !!earning,
        }, { status: 500 });
      }
      // Bust the leads cache so this change shows up in the queue right away.
      try {
        const { revalidateTag } = await import("next/cache");
        revalidateTag("leads");
      } catch { /* not in app context */ }
    }

    return NextResponse.json({ ok: true, earning, stage_updated: !!wantStage });
  }

  return NextResponse.json({ error: `unknown action '${action}'` }, { status: 400 });
}
