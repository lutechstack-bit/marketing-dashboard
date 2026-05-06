// Debug: dump exactly what the /queue page would render for a given program.
// Mirrors the three parallel fetches the queue does, then groups by stage so
// we can see if any lead is appearing in multiple buckets.
//
// GET /api/debug/queue-render?program=FW&token=...

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!process.env.ADMIN_BOOTSTRAP_TOKEN || token !== process.env.ADMIN_BOOTSTRAP_TOKEN) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const program = url.searchParams.get("program") || "FW";

  const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } });

  // Mimic the three queue fetches
  const [partials, submitted, paid] = await Promise.all([
    admin.from("leads").select("id,email,phone,name,funnel_stage,score,program,first_seen,last_activity")
      .eq("program", program).eq("funnel_stage", "form_partial")
      .order("last_activity", { ascending: false, nullsFirst: false })
      .order("score", { ascending: false })
      .limit(1500),
    admin.from("leads").select("id,email,phone,name,funnel_stage,score,program,first_seen,last_activity")
      .eq("program", program).eq("funnel_stage", "form_submitted")
      .order("last_activity", { ascending: false, nullsFirst: false })
      .order("score", { ascending: false })
      .limit(3000),
    admin.from("leads").select("id,email,phone,name,funnel_stage,score,program,first_seen,last_activity")
      .eq("program", program).eq("funnel_stage", "app_fee_paid")
      .order("last_activity", { ascending: false, nullsFirst: false })
      .order("score", { ascending: false })
      .limit(1500),
  ]);

  const partialRows  = (partials.data || []) as any[];
  const submittedRows = (submitted.data || []) as any[];
  const paidRows = (paid.data || []) as any[];

  // Find any lead id appearing in more than one set
  const inPartial   = new Set(partialRows.map(l => l.id));
  const inSubmitted = new Set(submittedRows.map(l => l.id));
  const inPaid      = new Set(paidRows.map(l => l.id));
  const overlap = {
    partial_x_submitted: [...inPartial].filter(id => inSubmitted.has(id)),
    partial_x_paid:      [...inPartial].filter(id => inPaid.has(id)),
    submitted_x_paid:    [...inSubmitted].filter(id => inPaid.has(id)),
  };

  // Find any lead id duplicated WITHIN one set
  const findDupesIn = (rows: any[]) => {
    const seen = new Map<string, number>();
    for (const r of rows) seen.set(r.id, (seen.get(r.id) || 0) + 1);
    return [...seen.entries()].filter(([_, n]) => n > 1).map(([id, n]) => ({ id, count: n }));
  };

  // Top 5 names per bucket so the user can compare visually
  const top = (rows: any[]) => rows.slice(0, 5).map(r => ({
    id: r.id, name: r.name, email: r.email, phone: r.phone, score: r.score, last_activity: r.last_activity,
  }));

  return NextResponse.json({
    program,
    counts: {
      partial: partialRows.length,
      submitted: submittedRows.length,
      app_fee_paid: paidRows.length,
    },
    cross_bucket_overlap: overlap,
    in_bucket_dupes: {
      partial:   findDupesIn(partialRows),
      submitted: findDupesIn(submittedRows),
      paid:      findDupesIn(paidRows),
    },
    top_5_each: {
      partial: top(partialRows),
      submitted: top(submittedRows),
      paid: top(paidRows),
    },
  });
}
