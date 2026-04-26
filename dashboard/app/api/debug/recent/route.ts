// Quick debug endpoint — shows the most recent form_submissions, leads, payments
// so we can verify webhooks are firing without needing direct DB access.
//
// GET /api/debug/recent?minutes=120

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const minutes = Math.min(parseInt(url.searchParams.get("minutes") || "120"), 60 * 24 * 7);
  const sinceIso = new Date(Date.now() - minutes * 60_000).toISOString();

  try {
    const [subs, leads, pays, weekTotal] = await Promise.all([
      supabase.from("form_submissions")
        .select("id,form_id,program,is_completed,created_at,submitted_at,email,name")
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false })
        .limit(30),
      supabase.from("leads")
        .select("id,name,email,phone,program,funnel_stage,created_at,first_seen,last_activity")
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false })
        .limit(30),
      supabase.from("payments")
        .select("id,lead_id,account,program,payment_type,amount_inr,status,email,paid_at,created_at")
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false })
        .limit(30),
      // 7-day baseline so we can see the typical volume
      supabase.from("form_submissions")
        .select("form_id", { count: "exact", head: false })
        .gte("created_at", new Date(Date.now() - 7 * 86400_000).toISOString())
        .limit(2000),
    ]);

    const counts: Record<string, number> = {};
    for (const r of (weekTotal.data || [])) {
      const fid = (r as any).form_id;
      counts[fid] = (counts[fid] || 0) + 1;
    }

    return NextResponse.json({
      window: { minutes, since: sinceIso, now: new Date().toISOString() },
      recent: {
        form_submissions: subs.data || [],
        leads: leads.data || [],
        payments: pays.data || [],
      },
      baseline_7d_per_form: counts,
      counts: {
        recent_subs: subs.data?.length || 0,
        recent_leads: leads.data?.length || 0,
        recent_pays: pays.data?.length || 0,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
