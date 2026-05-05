// One-shot bootstrap endpoint — invites the 6 initial users + creates their
// sales_reps rows + their rep_assignments. Idempotent.
//
// Email rate-limit safe: when Supabase's email service is rate-limited, falls back
// to generateLink (no email sent) and returns the invite URL in the API response —
// admin can hand-deliver the link.
//
// Auth: ADMIN_BOOTSTRAP_TOKEN env var.
//
// Usage:
//   GET /api/admin/invite-users?token=<secret>

import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type InitUser = {
  email: string;
  full_name: string;
  role: "sales" | "founder" | "admin";
  phone?: string;
  // Optional rep_assignments to seed for sales reps
  assignments?: { product_code: string; edition_match?: string | null; edition_label?: string | null; incentive_inr: number; notes?: string }[];
};

// IMPORTANT: founders/admins listed first so they get invited before any rate limit hits.
const INITIAL_USERS: InitUser[] = [
  // Founders / admins
  { email: "hiresh@leveluplearning.in",     full_name: "Hiresh",    role: "admin" },
  { email: "ceo@leveluplearning.in",        full_name: "CEO",       role: "admin" },
  { email: "avinash@leveluplearning.in",    full_name: "Avinash",   role: "admin" },
  // Sales reps + their incentive assignments
  {
    email: "Pranaush47@gmail.com", full_name: "Pranaush", role: "sales",
    assignments: [
      { product_code: "FFM", incentive_inr: 5000, notes: "Default" },
      { product_code: "FW",  incentive_inr: 6500, notes: "Default" },
    ],
  },
  {
    email: "saisashank27@gmail.com", full_name: "Sashank", role: "sales",
    assignments: [
      { product_code: "FC",  edition_match: "goa",  edition_label: "Goa",  incentive_inr: 4500, notes: "Goa edition" },
      { product_code: "FC",  edition_match: "bali", edition_label: "Bali", incentive_inr: 7000, notes: "Bali edition" },
      { product_code: "FAI", incentive_inr: 8000, notes: "Default" },
      { product_code: "BFP", incentive_inr: 5000, notes: "Default" },
    ],
  },
  {
    email: "wilsonindrapalli@gmail.com", full_name: "Wilson", role: "sales",
    assignments: [
      { product_code: "VE",  incentive_inr: 4000, notes: "Default" },
      { product_code: "L3C", incentive_inr: 6000, notes: "Default" },
    ],
  },
];

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!process.env.ADMIN_BOOTSTRAP_TOKEN || token !== process.env.ADMIN_BOOTSTRAP_TOKEN) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || `${url.protocol}//${url.host}`;
  const results: any[] = [];

  for (const u of INITIAL_USERS) {
    const email = u.email.trim().toLowerCase();
    let userId: string | null = null;
    let inviteStatus = "";
    let inviteLink: string | null = null;

    // 1. Try invite (sends email). If rate-limited, fall back to generateLink (no email).
    try {
      const { data: inviteData, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${siteUrl}/auth/reset-password`,
        data: { full_name: u.full_name, role: u.role },
      });

      if (inviteErr) {
        const msg = (inviteErr.message || "").toLowerCase();
        const alreadyExists = /already.*registered|already.*exist|already invited|user.*exist/.test(msg);
        const rateLimited   = /rate limit/.test(msg);

        if (alreadyExists) {
          // Look up the existing user
          const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
          const existing = list?.users?.find(x => (x.email || "").toLowerCase() === email);
          userId = existing?.id ?? null;
          inviteStatus = "already_existed";
        } else if (rateLimited) {
          // Email rate-limited — generate a link without sending email
          const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
            type: "invite",
            email,
            options: { redirectTo: `${siteUrl}/auth/reset-password` },
          });
          if (linkErr) {
            results.push({ email, status: "link_error", error: linkErr.message });
            continue;
          }
          userId = linkData?.user?.id ?? null;
          inviteLink = linkData?.properties?.action_link ?? null;
          inviteStatus = "link_generated_no_email";
        } else {
          results.push({ email, status: "invite_error", error: inviteErr.message });
          continue;
        }
      } else {
        userId = inviteData?.user?.id ?? null;
        inviteStatus = "invited_email_sent";
      }
    } catch (e: any) {
      results.push({ email, status: "exception", error: e?.message });
      continue;
    }

    if (!userId) {
      results.push({ email, status: "no_user_id", invite_status: inviteStatus });
      continue;
    }

    // 2. Upsert sales_reps row
    const { error: upsertErr } = await admin.from("sales_reps").upsert({
      id: userId, email, full_name: u.full_name, phone: u.phone || null, role: u.role, active: true,
    }, { onConflict: "id" });
    if (upsertErr) {
      results.push({ email, status: "rep_upsert_error", error: upsertErr.message, user_id: userId });
      continue;
    }

    // 3. Upsert rep_assignments (if any) — dedup by (rep, product, edition_match)
    let assignmentsCreated = 0;
    if (u.assignments && u.assignments.length > 0) {
      for (const a of u.assignments) {
        let existsQ = admin.from("rep_assignments")
          .select("id")
          .eq("rep_id", userId)
          .eq("product_code", a.product_code)
          .eq("active", true);
        if (a.edition_match) existsQ = existsQ.eq("edition_match", a.edition_match);
        else                  existsQ = existsQ.is("edition_match", null);
        const { data: existing } = await existsQ.limit(1);
        if (existing && existing.length > 0) continue;

        const { error: aerr } = await admin.from("rep_assignments").insert({
          rep_id: userId,
          product_code: a.product_code,
          edition_match: a.edition_match || null,
          edition_label: a.edition_label || null,
          incentive_inr: a.incentive_inr,
          notes: a.notes || null,
          active: true,
        });
        if (!aerr) assignmentsCreated++;
      }
    }

    // 4. ALWAYS generate a fresh recovery link with the current site URL.
    // (Previous run's links had wrong redirect_to because Supabase Site URL was localhost.)
    let recoveryLink: string | null = null;
    try {
      const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
        type: "recovery",
        email,
        options: { redirectTo: `${siteUrl}/auth/reset-password` },
      });
      if (!linkErr) recoveryLink = linkData?.properties?.action_link ?? null;
    } catch { /* non-fatal */ }

    results.push({
      email,
      status: inviteStatus,
      role: u.role,
      user_id: userId,
      assignments_created: assignmentsCreated,
      ...(inviteLink ? { invite_link_initial: inviteLink } : {}),
      ...(recoveryLink ? { set_password_link: recoveryLink } : {}),
    });
  }

  return NextResponse.json({ ok: true, count: results.length, results });
}
