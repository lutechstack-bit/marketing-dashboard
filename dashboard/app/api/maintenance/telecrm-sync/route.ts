// Sync leads FROM TeleCRM into our Supabase.
//
// Problem this solves: previously each subsystem had its own attribution path
// (Tally form_id mapping, Razorpay amount-based program inference, manual
// Sheet entries). They drifted, leaving 300 leads with program=unknown, lost
// reasons buried in form_submissions JSON, and per-page numbers that didn't
// match. TeleCRM is the operational hub the team actually uses — every lead,
// every status change, every lost reason lands there. Pulling from TeleCRM
// makes our dashboard a derivative analytics layer on top of the canonical
// CRM, eliminating the attribution drift at the source.
//
// Usage:
//   POST /api/maintenance/telecrm-sync?token=<ADMIN_BOOTSTRAP_TOKEN>
//   Body (optional):
//     { since_ms?: number, max_pages?: number, dry_run?: boolean }
//
//   - since_ms   : only sync leads with modified_on > this (incremental)
//   - max_pages  : safety cap, default 500 (50k leads)
//   - dry_run    : log what would change but don't write

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCurrentRep } from "@/lib/auth/supabase-server";
import { normalizeTelecrmLead, pickHigherStage } from "@/lib/telecrm-mapping";
import crypto from "crypto";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes — large syncs need it

const SYNC_BASE = "https://next.telecrm.in/autoupdate/v2";

function adminClient() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

async function fetchTelecrmPage(opts: {
  enterpriseId: string;
  token: string;
  skip: number;
  limit: number;
  sinceMs?: number;
}): Promise<{ leads: any[]; total: number }> {
  const { enterpriseId, token, skip, limit, sinceMs } = opts;
  const body: any = { fields: {} };
  if (sinceMs && sinceMs > 0) {
    // TeleCRM accepts created_on with from/to as DD/MM/YYYY HH:MM:SS strings.
    // Easier: don't filter on the API side, filter locally on modified_on.
    // For 38k leads this is fine — full pull takes <2 min.
  }
  const res = await fetch(`${SYNC_BASE}/enterprise/${enterpriseId}/lead/search?skip=${skip}&limit=${limit}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`TeleCRM lead/search ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return { leads: data.data || data.leads || [], total: data.total_count || 0 };
}

export async function POST(req: Request) {
  // Auth: bootstrap token OR admin/founder session
  const url = new URL(req.url);
  const adminToken = url.searchParams.get("token");
  const tokenOk = process.env.ADMIN_BOOTSTRAP_TOKEN && adminToken === process.env.ADMIN_BOOTSTRAP_TOKEN;
  if (!tokenOk) {
    const rep = await getCurrentRep();
    if (!rep) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (rep.role !== "admin" && rep.role !== "founder") {
      return NextResponse.json({ error: "admin or founder role required" }, { status: 403 });
    }
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "missing supabase env" }, { status: 500 });
  }
  const body = await req.json().catch(() => ({})) as {
    since_ms?: number;
    max_pages?: number;
    start_skip?: number;
    dry_run?: boolean;
    // First-run override: when env vars aren't set yet, pass the TeleCRM
    // credentials in the request body. Bootstrap-token-protected, so this
    // is safe for one-off runs from a CLI / cron until Vercel env is wired.
    telecrm_token?: string;
    telecrm_enterprise_id?: string;
  };

  const tcrmToken = process.env.TELECRM_SYNC_TOKEN || body.telecrm_token;
  const enterpriseId = process.env.TELECRM_ENTERPRISE_ID || body.telecrm_enterprise_id;
  if (!tcrmToken || !enterpriseId) {
    return NextResponse.json({ error: "missing TELECRM_SYNC_TOKEN or TELECRM_ENTERPRISE_ID (set env or pass telecrm_token + telecrm_enterprise_id in body)" }, { status: 500 });
  }
  const sinceMs = body.since_ms || 0;
  const maxPages = body.max_pages || 30;          // ~3000 leads / call → fits in 60s
  const dryRun = !!body.dry_run;
  const PAGE = 100;
  const TIME_BUDGET_MS = 50_000;                  // bail before Vercel kills us
  const startSkip = body.start_skip || 0;

  const t0 = Date.now();
  const stats = {
    pages: 0, fetched: 0, normalized: 0, skipped_noidentity: 0,
    inserted: 0, updated: 0, merged: 0, errors: 0, total_in_telecrm: 0,
    duration_ms: 0,
    next_skip: null as number | null,             // resume here on next call
    done: false,
  };
  const sampleErrors: string[] = [];

  const admin = adminClient();

  let skip = startSkip;
  for (let p = 0; p < maxPages; p++) {
    let pageData;
    try {
      pageData = await fetchTelecrmPage({ enterpriseId, token: tcrmToken, skip, limit: PAGE, sinceMs });
    } catch (e: any) {
      sampleErrors.push(`page ${p}: fetch failed: ${e.message}`);
      stats.errors++;
      break;
    }
    if (p === 0) stats.total_in_telecrm = pageData.total;
    if (pageData.leads.length === 0) break;
    stats.pages++;
    stats.fetched += pageData.leads.length;

    // Normalize
    const normalized = pageData.leads
      .map(normalizeTelecrmLead)
      .filter(Boolean) as ReturnType<typeof normalizeTelecrmLead>[];
    stats.normalized += normalized.length;
    stats.skipped_noidentity += pageData.leads.length - normalized.length;

    if (sinceMs > 0) {
      // Local filter — keep only those modified after sinceMs
      for (let i = normalized.length - 1; i >= 0; i--) {
        const n = normalized[i]!;
        const modMs = n.last_activity ? new Date(n.last_activity).getTime() : 0;
        if (modMs <= sinceMs) normalized.splice(i, 1);
      }
    }

    if (normalized.length === 0) {
      skip += pageData.leads.length;
      if (pageData.leads.length < PAGE) break;
      continue;
    }

    // Pre-fetch existing matches (email-keyed + phone-keyed)
    const allEmails = Array.from(new Set(normalized.filter(n => n!.email).map(n => n!.email!)));
    const allPhones = Array.from(new Set(normalized.filter(n => n!.phone).map(n => n!.phone!)));
    const allPrograms = Array.from(new Set(normalized.map(n => n!.program!)));

    let existing: any[] = [];
    if (allEmails.length || allPhones.length) {
      const orParts: string[] = [];
      if (allEmails.length) orParts.push(`email.in.(${allEmails.map(e => `"${e}"`).join(",")})`);
      if (allPhones.length) orParts.push(`phone.in.(${allPhones.map(p => `"${p}"`).join(",")})`);
      const { data, error } = await admin
        .from("leads")
        .select("id,email,phone,program,name,score,funnel_stage,first_seen,source_campaign_id,source_campaign_name,source_utm_source,score_breakdown")
        .in("program", allPrograms)
        .or(orParts.join(","));
      if (error) {
        sampleErrors.push(`page ${p}: prefetch: ${error.message}`);
        stats.errors++;
        skip += pageData.leads.length;
        continue;
      }
      existing = data || [];
    }

    const claimedByEmail = new Map<string, string>();
    const claimedByPhone = new Map<string, string>();
    const existingById = new Map<string, any>();
    for (const r of existing) {
      existingById.set(r.id, r);
      if (r.email && r.program) claimedByEmail.set(`${r.email}|${r.program}`, r.id);
      if (r.phone && r.program) claimedByPhone.set(`${r.phone}|${r.program}`, r.id);
    }

    // Build upsert rows — leads + form_submissions (one synthetic submission per TeleCRM lead)
    const leadRowsById = new Map<string, any>();
    const subRowsById  = new Map<string, any>();

    for (const n of normalized) {
      if (!n) continue;
      const ek = n.email ? `${n.email}|${n.program}` : null;
      const pk = n.phone ? `${n.phone}|${n.program}` : null;
      const idByE = ek ? claimedByEmail.get(ek) : undefined;
      const idByP = pk ? claimedByPhone.get(pk) : undefined;

      let id: string;
      if (idByE && idByP && idByE !== idByP) { id = idByE; stats.merged++; }
      else if (idByE) id = idByE;
      else if (idByP) id = idByP;
      else id = crypto.randomUUID();

      const ex = existingById.get(id);
      if (ex) stats.updated++; else stats.inserted++;

      // Resolve final values — TeleCRM wins on every field EXCEPT funnel_stage
      // (where we use pickHigherStage to never downgrade) and first_seen
      // (preserve earliest known).
      const isJunkName = (s?: string | null) =>
        !s || /^\d{10,}$/.test(s) || /^(test ad|null|undefined|-|—)$/i.test(s.trim());
      let finalEmail: string | null = ex?.email || n.email;
      let finalPhone: string | null = ex?.phone || n.phone;
      const finalName  = (!isJunkName(ex?.name) ? ex?.name : null) || n.name;

      // Conflict-safe field selection — never write an email/phone that's
      // already claimed by a different lead id, since (email,program) and
      // (phone,program) are unique in Supabase. Without this, an email-merge
      // case where the TeleCRM lead's phone matches a *different* DB row
      // produces a unique-constraint violation on bulk upsert.
      if (idByE && idByP && idByE !== idByP) {
        finalPhone = ex?.phone || null;          // drop conflicting phone
      }
      if (finalEmail) {
        const claimedBy = claimedByEmail.get(`${finalEmail}|${n.program}`);
        if (claimedBy && claimedBy !== id) finalEmail = ex?.email || null;
      }
      if (finalPhone) {
        const claimedBy = claimedByPhone.get(`${finalPhone}|${n.program}`);
        if (claimedBy && claimedBy !== id) finalPhone = ex?.phone || null;
      }
      // Update claim maps so subsequent rows in this batch see the bindings
      if (finalEmail) claimedByEmail.set(`${finalEmail}|${n.program}`, id);
      if (finalPhone) claimedByPhone.set(`${finalPhone}|${n.program}`, id);
      const finalStage = pickHigherStage(ex?.funnel_stage, n.funnel_stage);
      const finalFirstSeen = ex?.first_seen || n.first_seen;
      // TeleCRM is canonical on score / attribution — overwrite always
      const finalScore = n.score;
      const finalBreakdown = n.score_breakdown;
      const finalSourceUtm = n.source_utm_source ?? ex?.source_utm_source ?? null;
      const finalSourceId  = n.source_campaign_id ?? ex?.source_campaign_id ?? null;
      const finalSourceNam = n.source_campaign_name ?? ex?.source_campaign_name ?? null;

      leadRowsById.set(id, {
        id,
        email: finalEmail, phone: finalPhone, name: finalName,
        program: n.program,
        funnel_stage: finalStage,
        score: finalScore,
        score_breakdown: finalBreakdown,
        source_utm_source: finalSourceUtm,
        source_campaign_id: finalSourceId,
        source_campaign_name: finalSourceNam,
        first_seen: finalFirstSeen,
        last_activity: n.last_activity,
      });

      // form_submissions row — stable ID by hashing telecrm_id so re-imports are idempotent
      const subId = `tcrm_${crypto.createHash("sha1").update(n.telecrm_id).digest("hex").slice(0, 24)}`;
      subRowsById.set(subId, {
        id: subId,
        lead_id: id,
        form_id: "telecrm_sync",
        form_name: `TeleCRM · ${n.responses?.form_source || "sync"}`,
        program: n.program,
        is_completed: true,
        submitted_at: n.first_seen,
        email: n.email,
        phone: n.phone,
        name: n.name,
        responses: n.responses,
      });

      if (ek) claimedByEmail.set(ek, id);
      if (pk) claimedByPhone.set(pk, id);
    }

    if (!dryRun && leadRowsById.size > 0) {
      const leadRows = Array.from(leadRowsById.values());
      const subRows = Array.from(subRowsById.values());

      const { error: leadErr } = await admin.from("leads").upsert(leadRows, { onConflict: "id" });
      if (leadErr) {
        if (sampleErrors.length < 6) sampleErrors.push(`page ${p}: bulk: ${leadErr.message.slice(0, 220)}`);
        // Recover row-by-row. Count only the rows that genuinely fail —
        // per-row retries that succeed are NOT errors, just slower writes.
        let realFailures = 0;
        for (const r of leadRows) {
          const { error: e2 } = await admin.from("leads").upsert([r], { onConflict: "id" });
          if (e2) {
            realFailures++;
            if (sampleErrors.length < 8) sampleErrors.push(`row ${r.id.slice(0, 8)}: ${e2.message.slice(0, 100)}`);
          }
        }
        stats.errors += realFailures;
      }
      const { error: subErr } = await admin.from("form_submissions").upsert(subRows, { onConflict: "id" });
      if (subErr) {
        sampleErrors.push(`page ${p}: sub upsert: ${subErr.message.slice(0, 200)}`);
      }
    }

    skip += pageData.leads.length;
    if (pageData.leads.length < PAGE) {
      stats.done = true;
      break;
    }
    // Stop early if we're approaching the Vercel timeout
    if (Date.now() - t0 > TIME_BUDGET_MS) {
      stats.next_skip = skip;
      break;
    }
  }
  if (!stats.done && stats.next_skip === null && stats.fetched > 0) {
    stats.next_skip = skip;
  }

  stats.duration_ms = Date.now() - t0;
  return NextResponse.json({
    ok: true,
    dry_run: dryRun,
    stats,
    sample_errors: sampleErrors.slice(0, 10),
  });
}

// GET shows the most recent sync stats (helpful for cron debugging)
export async function GET() {
  return NextResponse.json({
    status: "alive",
    docs: "POST /api/maintenance/telecrm-sync?token=<ADMIN_BOOTSTRAP_TOKEN> — body: { since_ms?, max_pages?, dry_run? }",
  });
}
