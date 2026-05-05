// Debug: dump auth user(s) and sales_reps row for a given email.
// Token-gated by ADMIN_BOOTSTRAP_TOKEN.
//
// GET /api/debug/whoami?email=<email>&token=<bootstrap_token>

import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!process.env.ADMIN_BOOTSTRAP_TOKEN || token !== process.env.ADMIN_BOOTSTRAP_TOKEN) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const email = (url.searchParams.get("email") || "").trim().toLowerCase();
  if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });

  const admin = createAdminClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // 1. All auth users matching this email (handles rare duplicates)
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const authMatches = (list?.users || [])
    .filter(u => (u.email || "").toLowerCase() === email)
    .map(u => ({
      id: u.id,
      email: u.email,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at,
      email_confirmed_at: u.email_confirmed_at,
      banned_until: (u as any).banned_until,
    }));

  // 2. sales_reps rows by email (regardless of id)
  const { data: repsByEmail } = await admin.from("sales_reps").select("*").eq("email", email);
  // 3. sales_reps rows by each auth user id (in case email mismatch)
  const repsByIds: Record<string, any> = {};
  for (const u of authMatches) {
    const { data } = await admin.from("sales_reps").select("*").eq("id", u.id).maybeSingle();
    repsByIds[u.id] = data;
  }

  // 4. Mirror the EXACT call middleware makes (raw fetch via PostgREST)
  const restCalls: Record<string, any> = {};
  for (const u of authMatches) {
    try {
      const r = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/sales_reps?id=eq.${u.id}&select=role,active`,
        {
          headers: {
            apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
            Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
          },
        },
      );
      const body = await r.text();
      restCalls[u.id] = { status: r.status, body };
    } catch (e: any) {
      restCalls[u.id] = { error: e?.message };
    }
  }

  return NextResponse.json({
    email,
    auth_users: authMatches,
    sales_reps_by_email: repsByEmail || [],
    sales_reps_by_auth_id: repsByIds,
    middleware_simulation_via_postgrest: restCalls,
  });
}
