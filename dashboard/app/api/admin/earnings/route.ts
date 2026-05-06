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

  // Edit an existing manual earning. Only manual earnings (those whose
  // trigger_slot_payment_id starts with 'manual_') are editable — webhook-
  // generated earnings stay immutable. Editable fields:
  //   amount_inr · rep_id · product_code · edition_label · notes
  //   locked_at (conversion date) · status (locked/unlocked/approved)
  if (action === "update_earning") {
    const { earning_id, amount_inr, rep_id, product_code, edition_label,
            notes, locked_at, status } = body || {};
    if (!earning_id) return NextResponse.json({ error: "earning_id required" }, { status: 400 });

    // Pull the existing earning and confirm it's manual
    const { data: existing, error: fetchErr } = await supabase
      .from("incentive_earnings")
      .select("*")
      .eq("id", earning_id)
      .maybeSingle();
    if (fetchErr || !existing) {
      return NextResponse.json({ error: fetchErr?.message || "earning not found" }, { status: 404 });
    }
    if (!existing.trigger_slot_payment_id || !String(existing.trigger_slot_payment_id).startsWith("manual_")) {
      return NextResponse.json({ error: "only manual earnings are editable" }, { status: 403 });
    }
    if (existing.status === "paid_out") {
      return NextResponse.json({ error: "cannot edit a paid-out earning" }, { status: 403 });
    }

    const updates: Record<string, any> = {};
    if (amount_inr !== undefined) {
      const amt = Number(amount_inr);
      if (!Number.isFinite(amt) || amt <= 0) {
        return NextResponse.json({ error: "amount_inr must be > 0" }, { status: 400 });
      }
      updates.amount_inr = amt;
    }
    if (rep_id !== undefined && rep_id !== null && rep_id !== "")    updates.rep_id = rep_id;
    if (product_code !== undefined && product_code !== null && product_code !== "") updates.product_code = product_code;
    if (edition_label !== undefined) updates.edition_label = edition_label || null;
    if (notes !== undefined)         updates.notes = notes || null;
    if (locked_at !== undefined && locked_at !== null && locked_at !== "") {
      const parsed = new Date(locked_at);
      if (isNaN(parsed.getTime())) return NextResponse.json({ error: "locked_at invalid" }, { status: 400 });
      if (parsed.getTime() > Date.now() + 86400_000) {
        return NextResponse.json({ error: "locked_at can't be in the future" }, { status: 400 });
      }
      updates.locked_at = parsed.toISOString();
    }
    // Status transitions — controlled. Setting unlocked/approved also sets timestamps.
    if (status !== undefined) {
      const validStatuses = ["locked", "unlocked", "approved", "reverted"];
      if (!validStatuses.includes(status)) {
        return NextResponse.json({ error: `status must be one of ${validStatuses.join(", ")}` }, { status: 400 });
      }
      updates.status = status;
      const nowIso = new Date().toISOString();
      if (status === "unlocked" && !existing.unlocked_at) updates.unlocked_at = nowIso;
      if (status === "approved") {
        if (!existing.unlocked_at) updates.unlocked_at = nowIso;
        if (!existing.approved_at) {
          updates.approved_at = nowIso;
          updates.approved_by = adminId;
        }
      }
      if (status === "reverted") updates.reverted_at = nowIso;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "no editable fields provided" }, { status: 400 });
    }

    const { data: updated, error: updErr } = await supabase
      .from("incentive_earnings")
      .update(updates)
      .eq("id", earning_id)
      .select("*")
      .maybeSingle();
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

    // Audit log
    await supabase.from("incentive_audit_log").insert({
      earning_id,
      actor_id: adminId,
      event_type: "manual_edit",
      from_status: existing.status,
      to_status: updates.status || existing.status,
      reason: `manual edit: ${Object.keys(updates).join(", ")}`,
    }).then(() => {}, () => {}); // best-effort

    try {
      const { revalidateTag } = await import("next/cache");
      revalidateTag("leads");
    } catch {}

    return NextResponse.json({ ok: true, earning: updated, changed_fields: Object.keys(updates) });
  }

  // Delete a manual earning entirely. Same restrictions as update_earning.
  if (action === "delete_earning") {
    const { earning_id, reason } = body || {};
    if (!earning_id) return NextResponse.json({ error: "earning_id required" }, { status: 400 });

    const { data: existing } = await supabase
      .from("incentive_earnings")
      .select("*")
      .eq("id", earning_id)
      .maybeSingle();
    if (!existing) return NextResponse.json({ error: "earning not found" }, { status: 404 });
    if (!existing.trigger_slot_payment_id || !String(existing.trigger_slot_payment_id).startsWith("manual_")) {
      return NextResponse.json({ error: "only manual earnings can be deleted" }, { status: 403 });
    }
    if (existing.status === "paid_out") {
      return NextResponse.json({ error: "cannot delete a paid-out earning" }, { status: 403 });
    }

    // Soft-delete via revert (preserves the row for audit). Hard-delete is
    // available if the admin really wants it via ?hard=true.
    const url = new URL(req.url);
    const hard = url.searchParams.get("hard") === "true";
    if (hard) {
      const { error: delErr } = await supabase.from("incentive_earnings").delete().eq("id", earning_id);
      if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
    } else {
      const { error: revErr } = await supabase.from("incentive_earnings").update({
        status: "reverted",
        reverted_at: new Date().toISOString(),
        notes: existing.notes
          ? `${existing.notes} · reverted: ${reason || "manual revert"}`
          : `Reverted: ${reason || "manual revert"}`,
      }).eq("id", earning_id);
      if (revErr) return NextResponse.json({ error: revErr.message }, { status: 500 });
    }

    await supabase.from("incentive_audit_log").insert({
      earning_id,
      actor_id: adminId,
      event_type: hard ? "manual_hard_delete" : "manual_revert",
      from_status: existing.status,
      to_status: hard ? "(deleted)" : "reverted",
      reason: reason || "manual delete",
    }).then(() => {}, () => {});

    try {
      const { revalidateTag } = await import("next/cache");
      revalidateTag("leads");
    } catch {}

    return NextResponse.json({ ok: true, hard_deleted: hard });
  }

  return NextResponse.json({ error: `unknown action '${action}'` }, { status: 400 });
}
