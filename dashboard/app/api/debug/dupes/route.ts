// Debug: find duplicates within a program — same email or phone appearing on
// multiple lead rows (which would explain the "same leads in every bucket"
// symptom on /queue).
//
// GET /api/debug/dupes?program=FW&token=...

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

  // Pull all leads for this program — paginated past the 1000 cap
  const all: any[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await admin
      .from("leads")
      .select("id,email,phone,name,funnel_stage,score,created_at,first_seen")
      .eq("program", program)
      .order("id")
      .range(from, from + 999);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }

  // Group by email AND by phone — find groups with >1 row
  const byEmail = new Map<string, any[]>();
  const byPhone = new Map<string, any[]>();
  for (const l of all) {
    if (l.email) {
      const k = String(l.email).toLowerCase();
      if (!byEmail.has(k)) byEmail.set(k, []);
      byEmail.get(k)!.push(l);
    }
    if (l.phone) {
      const k = String(l.phone);
      if (!byPhone.has(k)) byPhone.set(k, []);
      byPhone.get(k)!.push(l);
    }
  }

  const emailDupes = Array.from(byEmail.entries()).filter(([_, rows]) => rows.length > 1)
    .map(([email, rows]) => ({ email, count: rows.length, rows }));
  const phoneDupes = Array.from(byPhone.entries()).filter(([_, rows]) => rows.length > 1)
    .map(([phone, rows]) => ({ phone, count: rows.length, rows }));

  // Stage distribution among email-dupe rows (so we can see if dupes have
  // different funnel_stages = the symptom)
  const stageOverlap = emailDupes.slice(0, 20).map(g => ({
    email: g.email,
    rows: g.rows.map((r: any) => ({
      id: r.id, stage: r.funnel_stage, name: r.name, score: r.score,
      phone: r.phone, created_at: r.created_at,
    })),
  }));

  return NextResponse.json({
    program,
    total_rows: all.length,
    email_dupe_groups: emailDupes.length,
    phone_dupe_groups: phoneDupes.length,
    sample_email_dupes: stageOverlap,
    sample_phone_dupes: phoneDupes.slice(0, 5).map(g => ({
      phone: g.phone,
      rows: g.rows.map((r: any) => ({ id: r.id, stage: r.funnel_stage, name: r.name, email: r.email })),
    })),
  });
}
