// One-time backfill: attribute the 300 leads with program=unknown.
//
// Source order of truth (first match wins):
//   1. form_submissions.program for any non-CSV submission tied to this lead
//   2. payments.program for any captured payment tied to this lead
//   3. payments.raw.payload.payment.entity.notes.program (Razorpay notes)
//   4. payments.raw.payload.payment.entity.description (regex VE/BFP/L3C/FFM/FW/FC/FAI)
//
// Runs via:
//   POST /api/maintenance/backfill-unknown-program?token=<ADMIN_BOOTSTRAP_TOKEN>
// Body (optional): { dry_run?: boolean }

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCurrentRep } from "@/lib/auth/supabase-server";
import { revalidateTag } from "next/cache";
import { PRODUCTS } from "@/lib/products";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const KNOWN_CODES = PRODUCTS.map(p => p.code);
const CODE_REGEX = new RegExp(`\\b(${KNOWN_CODES.join("|")})\\b`, "i");

function adminClient() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

function normalizeProgram(p: any): string | null {
  if (p == null) return null;
  const k = String(p).trim().toUpperCase();
  if (!k || k === "-" || k === "—" || k === "UNKNOWN") return null;
  if (KNOWN_CODES.includes(k)) return k;
  // Match aliases
  if (/FORGE\s*FILM/i.test(k))    return "FFM";
  if (/FORGE\s*WRIT/i.test(k))    return "FW";
  if (/FORGE\s*CREAT/i.test(k))   return "FC";
  if (/FORGE\s*AI/i.test(k))      return "FAI";
  if (/BREAKTHROUGH|^BFP$/i.test(k)) return "BFP";
  if (/VIDEO\s*EDIT|^VE$/i.test(k))  return "VE";
  if (/L3\s*C|LEVELUP\s*CREAT/i.test(k)) return "L3C";
  return null;
}

/**
 * Resolve program for a lead from its related rows. Returns null if undecidable.
 */
function resolveProgram(
  formSubs: { program: string | null; form_id: string | null }[],
  payments: { program: string | null; raw: any }[],
): { program: string | null; source: string } {
  // 1. form_submissions — but skip 'csv_import' and 'unknown' since those are noisy
  for (const fs of formSubs) {
    const norm = normalizeProgram(fs.program);
    if (norm && fs.form_id !== "unknown") {
      return { program: norm, source: `form_${fs.form_id || "?"}` };
    }
  }
  // 2. payments.program (set explicitly by the Razorpay webhook for known amounts)
  for (const p of payments) {
    const norm = normalizeProgram(p.program);
    if (norm) return { program: norm, source: "payment.program" };
  }
  // 3. Razorpay notes — if `notes.program` was set on the payment link
  for (const p of payments) {
    const notes = p.raw?.payload?.payment?.entity?.notes || {};
    if (notes.program) {
      const norm = normalizeProgram(notes.program);
      if (norm) return { program: norm, source: "rzp.notes.program" };
    }
    // Sometimes the program is mentioned in the notes' other keys
    for (const v of Object.values(notes)) {
      if (typeof v === "string") {
        const m = v.match(CODE_REGEX);
        if (m) return { program: m[1].toUpperCase(), source: "rzp.notes.scan" };
      }
    }
  }
  // 4. Razorpay description — text on the payment page
  for (const p of payments) {
    const desc: string = p.raw?.payload?.payment?.entity?.description || "";
    const m = desc.match(CODE_REGEX);
    if (m) return { program: m[1].toUpperCase(), source: "rzp.description" };
  }
  return { program: null, source: "no-signal" };
}

export async function POST(req: Request) {
  // Auth: bootstrap token OR admin/founder
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const tokenOk = process.env.ADMIN_BOOTSTRAP_TOKEN && token === process.env.ADMIN_BOOTSTRAP_TOKEN;
  if (!tokenOk) {
    const rep = await getCurrentRep();
    if (!rep) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (rep.role !== "admin" && rep.role !== "founder") {
      return NextResponse.json({ error: "admin or founder required" }, { status: 403 });
    }
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "missing supabase env" }, { status: 500 });
  }

  const body = await req.json().catch(() => ({})) as { dry_run?: boolean };
  const dryRun = !!body.dry_run;

  const admin = adminClient();
  const t0 = Date.now();

  // Pull all unknown-program leads
  const { data: ghosts, error } = await admin
    .from("leads")
    .select("id,email,phone,funnel_stage")
    .or("program.is.null,program.eq.unknown")
    .limit(2000);
  if (error) return NextResponse.json({ error: `fetch ghosts: ${error.message}` }, { status: 500 });
  const ghostList = (ghosts || []) as any[];

  if (ghostList.length === 0) {
    return NextResponse.json({ ok: true, ghosts_found: 0, message: "nothing to backfill" });
  }

  // Bulk-fetch related form_submissions and payments
  const ids = ghostList.map(g => g.id);
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 200) chunks.push(ids.slice(i, i + 200));

  const [subResults, payResults] = await Promise.all([
    Promise.all(chunks.map(c =>
      admin.from("form_submissions").select("lead_id,form_id,program").in("lead_id", c)
    )),
    Promise.all(chunks.map(c =>
      admin.from("payments").select("lead_id,program,raw").in("lead_id", c).eq("status", "captured")
    )),
  ]);

  const subsByLead: Record<string, any[]> = {};
  for (const r of subResults) for (const row of (r.data || [])) {
    (subsByLead[(row as any).lead_id] ||= []).push(row);
  }
  const paysByLead: Record<string, any[]> = {};
  for (const r of payResults) for (const row of (r.data || [])) {
    (paysByLead[(row as any).lead_id] ||= []).push(row);
  }

  // Resolve each
  type Resolution = { id: string; current: string | null; resolved: string | null; source: string };
  const resolutions: Resolution[] = [];
  for (const g of ghostList) {
    const r = resolveProgram(subsByLead[g.id] || [], paysByLead[g.id] || []);
    resolutions.push({ id: g.id, current: g.program ?? null, resolved: r.program, source: r.source });
  }

  const decided = resolutions.filter(r => r.resolved);
  const undecided = resolutions.filter(r => !r.resolved);

  // Source breakdown
  const sourceCounts: Record<string, number> = {};
  for (const r of decided) sourceCounts[r.source] = (sourceCounts[r.source] || 0) + 1;

  // Apply updates (skip on dry-run)
  let updated = 0;
  if (!dryRun && decided.length > 0) {
    // Group by program for batched updates (much fewer round-trips than per-row)
    const byProgram: Record<string, string[]> = {};
    for (const r of decided) (byProgram[r.resolved!] ||= []).push(r.id);
    for (const [prog, leadIds] of Object.entries(byProgram)) {
      const { error: updErr } = await admin
        .from("leads")
        .update({ program: prog, last_activity: new Date().toISOString() })
        .in("id", leadIds);
      if (updErr) {
        return NextResponse.json({
          error: `update failed for ${prog}: ${updErr.message}`,
          partial_updated: updated,
        }, { status: 500 });
      }
      updated += leadIds.length;
    }
    revalidateTag("leads");
  }

  return NextResponse.json({
    ok: true,
    dry_run: dryRun,
    ghosts_found: ghostList.length,
    decided: decided.length,
    undecided: undecided.length,
    updated,
    source_counts: sourceCounts,
    sample_resolutions: resolutions.slice(0, 12).map(r => ({
      id: r.id.slice(0, 8),
      resolved: r.resolved,
      source: r.source,
    })),
    sample_undecided: undecided.slice(0, 8).map(r => r.id.slice(0, 8)),
    duration_ms: Date.now() - t0,
  }, { headers: { "Cache-Control": "no-store" } });
}
