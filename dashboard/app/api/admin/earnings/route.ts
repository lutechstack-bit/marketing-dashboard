// Earnings actions for admins: approve, mark paid, batch operations.
// Auth: must be logged-in admin. Middleware already protected by /admin route prefix
// for route gating — here we add an explicit role check too.

import { NextResponse } from "next/server";
import { getCurrentRep, createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { approveEarning, markPaidOut } from "@/lib/earnings";
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

  return NextResponse.json({ error: `unknown action '${action}'` }, { status: 400 });
}
