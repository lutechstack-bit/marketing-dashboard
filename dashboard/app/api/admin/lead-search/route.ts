// Server-side lead search for the admin "manually attribute earning" /
// "update lead status" modal. Searches name / email / phone across the
// FULL 41k+ leads table (not the 1000-row default cap that the modal
// would otherwise hit if it loaded all leads to the client).
//
// GET /api/admin/lead-search?q=<query>
// Auth: admin or founder.

import { NextResponse } from "next/server";
import { getCurrentRep } from "@/lib/auth/supabase-server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const rep = await getCurrentRep();
  if (!rep) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (rep.role !== "admin" && rep.role !== "founder") {
    return NextResponse.json({ error: "admin/founder required" }, { status: 403 });
  }

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  if (q.length < 2) return NextResponse.json({ leads: [] });

  // Sanitise q for PostgREST .or syntax — strip commas / parens / quotes.
  const sq = q.replace(/[,()'"\\*]/g, "");

  // Three parallel searches (PostgREST .or() with ilike doesn't index well across
  // multiple cols at once). Top 8 hits per column, deduplicated client-side.
  const [byEmail, byName, byPhone] = await Promise.all([
    supabase.from("leads")
      .select("id,name,email,phone,program,funnel_stage,score,first_seen,created_at")
      .ilike("email", `%${sq}%`)
      .limit(8),
    supabase.from("leads")
      .select("id,name,email,phone,program,funnel_stage,score,first_seen,created_at")
      .ilike("name", `%${sq}%`)
      .limit(8),
    supabase.from("leads")
      .select("id,name,email,phone,program,funnel_stage,score,first_seen,created_at")
      .ilike("phone", `%${sq.replace(/\D/g, "")}%`)
      .limit(8),
  ]);

  const seen = new Set<string>();
  const leads: any[] = [];
  for (const res of [byEmail, byName, byPhone]) {
    for (const l of (res.data || []) as any[]) {
      if (seen.has(l.id)) continue;
      seen.add(l.id);
      leads.push(l);
    }
  }
  return NextResponse.json({ leads: leads.slice(0, 20) });
}
