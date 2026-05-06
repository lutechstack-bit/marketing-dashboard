// TeleCRM activities sync — fetches per-lead action history (calls,
// status changes, notes) and writes to the lead_activities table.
//
// Scope: leads we've already synced from TeleCRM (we look up each lead's
// telecrm_id via form_submissions.responses, then call the per-lead
// action endpoint).
//
// API: POST /enterprise/{eid}/lead/{leadId}/action/search?limit=100
//      → returns activities for that lead (OUTGOING_CALL, STATUS_CHANGE, etc.)
//
// Strategy:
//   - Process N leads per HTTP call (default 50 → ~50 round trips × 200ms = 10s)
//   - Use start_skip for resumable pagination
//   - Idempotent: action.id is the PK, so re-runs upsert
//
// Usage:
//   POST /api/maintenance/telecrm-activities-sync?token=<ADMIN_BOOTSTRAP_TOKEN>
//   Body: { start_skip?: number, max_leads?: number, only_active?: boolean }

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCurrentRep } from "@/lib/auth/supabase-server";
import { revalidateTag } from "next/cache";
import crypto from "node:crypto";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Convert a 24-char Mongo ObjectID (TeleCRM action.id format) to a stable
// UUID v4-shape so it fits Postgres' uuid column type. Deterministic via
// SHA-1 so re-runs hit the same key (idempotent upsert).
function objectIdToUuid(objectId: string): string {
  const h = crypto.createHash("sha1").update(`tcrm:${objectId}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

const SYNC_BASE = "https://next.telecrm.in/autoupdate/v2";

function adminClient() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

type TelecrmAction = {
  id: string;
  employeeid?: string;
  type: string;
  creationTimestamp: number;
  modificationTimestamp?: number;
  note?: string;
  feedback?: string;
  duration?: number;
  fromStatusid?: number | string;
  toStatusid?: number | string;
};

async function fetchLeadActions(opts: {
  enterpriseId: string;
  token: string;
  telecrmLeadId: string;
}): Promise<TelecrmAction[]> {
  const { enterpriseId, token, telecrmLeadId } = opts;
  const res = await fetch(
    `${SYNC_BASE}/enterprise/${enterpriseId}/lead/${telecrmLeadId}/action/search?limit=100`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    }
  );
  if (!res.ok) {
    if (res.status === 404) return [];      // lead not in TeleCRM (deleted there)
    throw new Error(`TeleCRM action/search ${res.status}: ${(await res.text()).slice(0, 150)}`);
  }
  const j = await res.json();
  return (j.data || j.actions || []) as TelecrmAction[];
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
      return NextResponse.json({ error: "admin or founder required" }, { status: 403 });
    }
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "missing supabase env" }, { status: 500 });
  }
  const tcrmToken = process.env.TELECRM_SYNC_TOKEN;
  const enterpriseId = process.env.TELECRM_ENTERPRISE_ID;
  if (!tcrmToken || !enterpriseId) {
    return NextResponse.json({ error: "missing TELECRM env" }, { status: 500 });
  }

  const body = await req.json().catch(() => ({})) as {
    start_skip?: number;
    max_leads?: number;
    only_active?: boolean;
  };
  const skip = body.start_skip || 0;
  const maxLeads = body.max_leads || 50;
  const onlyActive = body.only_active !== false; // default true

  const TIME_BUDGET_MS = 50_000;
  const t0 = Date.now();
  const stats = {
    leads_scanned: 0,
    leads_with_telecrm_id: 0,
    actions_fetched: 0,
    actions_upserted: 0,
    errors: 0,
    next_skip: null as number | null,
    done: false,
  };
  const sampleErrors: string[] = [];

  const admin = adminClient();

  // Pull a batch of leads ordered by most-recently-modified, plus their
  // form_submissions row (where telecrm_id is stored).
  let q = admin
    .from("leads")
    .select("id,funnel_stage,last_activity")
    .order("last_activity", { ascending: false, nullsFirst: false });
  if (onlyActive) {
    // Active stages = anywhere in the funnel that's worth tracking activity for
    q = q.in("funnel_stage", ["form_submitted", "app_fee_paid", "accepted", "confirmed", "balance_paid"]);
  }
  q = q.range(skip, skip + maxLeads - 1);
  const { data: leads, error: leadsErr } = await q;
  if (leadsErr) {
    return NextResponse.json({ error: `leads fetch: ${leadsErr.message}` }, { status: 500 });
  }
  const leadList = (leads || []) as Array<{ id: string; funnel_stage: string | null; last_activity: string | null }>;
  stats.leads_scanned = leadList.length;
  if (leadList.length === 0) {
    stats.done = true;
    return NextResponse.json({ ok: true, stats, sample_errors: [] });
  }

  // Look up telecrm_id for each via form_submissions.responses
  const ids = leadList.map(l => l.id);
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 200) chunks.push(ids.slice(i, i + 200));
  const subResults = await Promise.all(
    chunks.map(c =>
      admin.from("form_submissions").select("lead_id,responses").in("lead_id", c).eq("form_id", "telecrm_sync")
    )
  );
  const tcrmIdByLead = new Map<string, string>();
  for (const r of subResults) {
    for (const row of (r.data || [])) {
      const tid = (row as any).responses?.telecrm_id;
      if (tid) tcrmIdByLead.set((row as any).lead_id, tid);
    }
  }
  stats.leads_with_telecrm_id = tcrmIdByLead.size;

  // Fetch actions per lead (in parallel batches of 8 to avoid hammering)
  const queue = leadList.filter(l => tcrmIdByLead.has(l.id));
  const upsertRows: any[] = [];
  const PARALLEL = 8;
  for (let i = 0; i < queue.length; i += PARALLEL) {
    if (Date.now() - t0 > TIME_BUDGET_MS) {
      stats.next_skip = skip + i; // roughly where we are
      break;
    }
    const slice = queue.slice(i, i + PARALLEL);
    const results = await Promise.all(slice.map(async (l) => {
      try {
        const actions = await fetchLeadActions({
          enterpriseId, token: tcrmToken, telecrmLeadId: tcrmIdByLead.get(l.id)!,
        });
        return { lead: l, actions };
      } catch (e: any) {
        if (sampleErrors.length < 6) sampleErrors.push(`lead ${l.id.slice(0, 8)}: ${e.message?.slice(0, 100)}`);
        stats.errors++;
        return { lead: l, actions: [] as TelecrmAction[] };
      }
    }));
    for (const { lead, actions } of results) {
      stats.actions_fetched += actions.length;
      for (const a of actions) {
        // Drop actions older than 90 days for now (keeps the dataset bounded;
        // can lift later if needed)
        const age = Date.now() - (a.creationTimestamp || 0);
        if (age > 90 * 86400_000) continue;
        upsertRows.push({
          id: objectIdToUuid(a.id),         // 24-char hex → UUID
          lead_id: lead.id,
          rep_name: a.employeeid || null,   // Firebase UID — name resolution TBD
          action: a.type || "UNKNOWN",
          notes: [a.note, a.feedback].filter(Boolean).join(" · ") || null,
          created_at: new Date(a.creationTimestamp).toISOString(),
        });
      }
    }
  }

  // Bulk upsert (chunked at 500 per request — Supabase PostgREST URL limit)
  for (let i = 0; i < upsertRows.length; i += 500) {
    const chunk = upsertRows.slice(i, i + 500);
    const { error: upErr } = await admin.from("lead_activities").upsert(chunk, { onConflict: "id" });
    if (upErr) {
      sampleErrors.push(`upsert ${i}: ${upErr.message.slice(0, 150)}`);
      stats.errors += chunk.length;
    } else {
      stats.actions_upserted += chunk.length;
    }
  }

  if (stats.next_skip == null) {
    if (leadList.length < maxLeads) stats.done = true;
    else stats.next_skip = skip + leadList.length;
  }

  if (stats.actions_upserted > 0) revalidateTag("leads");

  return NextResponse.json({
    ok: true,
    stats,
    sample_errors: sampleErrors.slice(0, 8),
    duration_ms: Date.now() - t0,
  });
}

export async function GET() {
  return NextResponse.json({
    status: "alive",
    docs: "POST ?token=<ADMIN_BOOTSTRAP_TOKEN> body: { start_skip?, max_leads?, only_active? }",
  });
}
