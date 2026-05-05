// One-shot bootstrap endpoint — invites the 6 initial users + creates their
// sales_reps rows. Idempotent: re-running just sends fresh invites.
//
// Auth: gated by ADMIN_BOOTSTRAP_TOKEN env var (set on Vercel, only run once).
//
// Usage:
//   GET /api/admin/invite-users?token=<secret>
//
// What it does:
//   1. For each user in INITIAL_USERS, calls Supabase Admin inviteUserByEmail
//      → Supabase sends them an email with a magic link to set password
//   2. Upserts their sales_reps row with the right role
//   3. Returns a summary

import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type InitUser = { email: string; full_name: string; role: "sales" | "founder" | "admin"; phone?: string };

const INITIAL_USERS: InitUser[] = [
  // Sales reps
  { email: "Pranaush47@gmail.com",         full_name: "Pranaush",  role: "sales" },
  { email: "saisashank27@gmail.com",        full_name: "Sashank",   role: "sales" },
  { email: "wilsonindrapalli@gmail.com",    full_name: "Wilson",    role: "sales" },
  // Founders / admins
  { email: "hiresh@leveluplearning.in",     full_name: "Hiresh",    role: "admin" },
  { email: "ceo@leveluplearning.in",        full_name: "CEO",       role: "admin" },
  { email: "avinash@leveluplearning.in",    full_name: "Avinash",   role: "admin" },
];

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const expected = process.env.ADMIN_BOOTSTRAP_TOKEN;
  if (!expected || token !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supaUrl = process.env.SUPABASE_URL!;
  const supaServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || `${url.protocol}//${url.host}`;

  const admin = createAdminClient(supaUrl, supaServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const results: any[] = [];

  for (const u of INITIAL_USERS) {
    const email = u.email.trim().toLowerCase();
    try {
      // 1. Send invite (Supabase generates auth user + sends "set password" email)
      const { data: inviteData, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${siteUrl}/auth/reset-password`,
        data: { full_name: u.full_name, role: u.role },
      });

      let userId: string | null = inviteData?.user?.id ?? null;

      // If invite fails because user already exists, look them up
      if (inviteErr && /already.*registered|already.*exist|already invited/i.test(inviteErr.message || "")) {
        const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
        const existing = list?.users?.find(x => (x.email || "").toLowerCase() === email);
        userId = existing?.id ?? null;
      } else if (inviteErr) {
        results.push({ email, status: "invite_error", error: inviteErr.message });
        continue;
      }

      if (!userId) {
        results.push({ email, status: "no_user_id" });
        continue;
      }

      // 2. Upsert sales_reps row
      const { error: upsertErr } = await admin.from("sales_reps").upsert({
        id: userId,
        email,
        full_name: u.full_name,
        phone: u.phone || null,
        role: u.role,
        active: true,
      }, { onConflict: "id" });

      if (upsertErr) {
        results.push({ email, status: "rep_upsert_error", error: upsertErr.message, user_id: userId });
        continue;
      }

      results.push({ email, status: inviteErr ? "already_existed_synced" : "invited", role: u.role, user_id: userId });
    } catch (e: any) {
      results.push({ email, status: "exception", error: e?.message });
    }
  }

  return NextResponse.json({ ok: true, results });
}
