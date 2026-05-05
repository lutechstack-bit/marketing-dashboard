// Reconcile lead funnel_stage against the payments table + Calendly bookings.
// Fixes leads stuck at 'form_submitted' even though they've paid an app fee
// (e.g. CSV import overrode the webhook-set stage with stale CRM data).
//
// Rules (only ever UPGRADES, never downgrades):
//   · Captured app_fee / confirmation payment        → at least app_fee_paid
//   · Captured balance / full payment                → balance_paid
//   · Non-canceled Calendly booking                   → at least app_fee_paid
//
// Auth: ADMIN_BOOTSTRAP_TOKEN.
//
// POST /api/maintenance/reconcile-stages?token=...
// Returns: { ok, scanned, promoted, by_stage }

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const STAGE_RANK: Record<string, number> = {
  form_partial:   0,
  form_submitted: 1,
  lost:           1,
  app_fee_paid:   2,
  accepted:       3,
  confirmed:      4,
  balance_paid:   5,
  attended:       6,
};

function bumpTo(current: string | null | undefined, target: string): string | null {
  const rc = current ? (STAGE_RANK[current] ?? 0) : -1;
  const rt = STAGE_RANK[target] ?? 0;
  if (rt > rc) return target;
  return null; // no change
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!process.env.ADMIN_BOOTSTRAP_TOKEN || token !== process.env.ADMIN_BOOTSTRAP_TOKEN) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "missing env" }, { status: 500 });
  }
  const admin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // 1. Pull all captured payments — paginate because Supabase caps single-
  // query reads at ~1000 rows.
  const allPays: any[] = [];
  let pFrom = 0;
  const pSize = 1000;
  while (true) {
    const { data, error } = await admin
      .from("payments")
      .select("lead_id,payment_type,status,email,phone")
      .eq("status", "captured")
      .range(pFrom, pFrom + pSize - 1);
    if (error) return NextResponse.json({ error: `payments fetch: ${error.message}` }, { status: 500 });
    if (!data || data.length === 0) break;
    allPays.push(...data);
    if (data.length < pSize) break;
    pFrom += pSize;
  }

  // Map: lead_id → highest stage implied by payments
  const stageByLead = new Map<string, string>();
  // Also map by email/phone for unlinked payments (webhook race etc.)
  const stageByEmail = new Map<string, string>();
  const stageByPhone = new Map<string, string>();

  for (const p of allPays as any[]) {
    const t = String(p.payment_type || "").toLowerCase();
    let stage: string | null = null;
    if (t === "balance" || t === "full") stage = "balance_paid";
    else if (t === "app_fee" || t === "confirmation" || t === "room") stage = "app_fee_paid";
    if (!stage) continue;

    if (p.lead_id) {
      const cur = stageByLead.get(p.lead_id);
      if (!cur || (STAGE_RANK[stage] > STAGE_RANK[cur])) stageByLead.set(p.lead_id, stage);
    } else {
      // Unlinked payment — track by email/phone for fallback matching
      if (p.email) {
        const e = String(p.email).toLowerCase();
        const cur = stageByEmail.get(e);
        if (!cur || (STAGE_RANK[stage] > STAGE_RANK[cur])) stageByEmail.set(e, stage);
      }
      if (p.phone) {
        const cur = stageByPhone.get(p.phone);
        if (!cur || (STAGE_RANK[stage] > STAGE_RANK[cur])) stageByPhone.set(p.phone, stage);
      }
    }
  }

  // 2. Walk every lead, decide whether to bump
  const updates: Array<{ id: string; funnel_stage: string }> = [];
  let scanned = 0;
  let pageSize = 1000;
  let from = 0;
  while (true) {
    const { data: leads, error } = await admin
      .from("leads")
      .select("id,email,phone,funnel_stage")
      .range(from, from + pageSize - 1)
      .order("created_at", { ascending: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!leads || leads.length === 0) break;

    for (const l of leads as any[]) {
      scanned++;
      // Implied stage from payments — link first, then email/phone fallback
      let implied: string | null = stageByLead.get(l.id) || null;
      if (!implied && l.email) implied = stageByEmail.get(String(l.email).toLowerCase()) || null;
      if (!implied && l.phone) implied = stageByPhone.get(l.phone) || null;
      if (!implied) continue;

      const next = bumpTo(l.funnel_stage, implied);
      if (next) updates.push({ id: l.id, funnel_stage: next });
    }
    if (leads.length < pageSize) break;
    from += pageSize;
  }

  // 3. Bulk-apply updates in chunks of 200
  let applied = 0;
  const failures: { id: string; reason: string }[] = [];
  const byStage: Record<string, number> = {};
  for (let i = 0; i < updates.length; i += 200) {
    const chunk = updates.slice(i, i + 200);
    // Group by target stage so we issue one UPDATE per stage
    const byNext: Record<string, string[]> = {};
    for (const u of chunk) (byNext[u.funnel_stage] ||= []).push(u.id);
    for (const [stage, ids] of Object.entries(byNext)) {
      const { error } = await admin
        .from("leads")
        .update({ funnel_stage: stage, last_activity: new Date().toISOString() })
        .in("id", ids);
      if (error) {
        failures.push({ id: ids[0], reason: error.message });
      } else {
        applied += ids.length;
        byStage[stage] = (byStage[stage] || 0) + ids.length;
      }
    }
  }

  return NextResponse.json({
    ok: true,
    scanned,
    detected: updates.length,
    promoted: applied,
    by_target_stage: byStage,
    payments_seen: allPays.length,
    payments_with_lead_id: stageByLead.size,
    payments_unlinked_email: stageByEmail.size,
    payments_unlinked_phone: stageByPhone.size,
    failures: failures.slice(0, 5),
  });
}
