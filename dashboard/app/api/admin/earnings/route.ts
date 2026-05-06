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

  // Manually attribute a conversion to a rep — creates a 'locked'
  // incentive_earnings row that follows the same lifecycle as a webhook-
  // created one. Use case: founder backfilling old conversions that
  // happened before the earnings system existed, or attributing organic
  // converters to the rep who actually pre-warmed them.
  if (action === "attribute_manual") {
    const { lead_id, rep_id, product_code, edition_label, amount_inr, notes } = body || {};
    if (!lead_id || !rep_id || !product_code || !amount_inr) {
      return NextResponse.json({
        error: "lead_id, rep_id, product_code, amount_inr required",
      }, { status: 400 });
    }
    const amt = Number(amount_inr);
    if (!Number.isFinite(amt) || amt <= 0) {
      return NextResponse.json({ error: "amount_inr must be > 0" }, { status: 400 });
    }
    const result = await manualLockEarning({
      lead_id,
      rep_id,
      product_code,
      edition_label: edition_label || null,
      amount_inr: amt,
      attributed_by: adminId,
      notes: notes || null,
    });
    if (!result) return NextResponse.json({ error: "failed to create earning" }, { status: 500 });
    return NextResponse.json({ ok: true, earning: result });
  }

  return NextResponse.json({ error: `unknown action '${action}'` }, { status: 400 });
}
