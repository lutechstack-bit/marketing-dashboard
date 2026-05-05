// Admin team management — invite, deactivate, edit role.

import { NextResponse } from "next/server";
import { getCurrentRep } from "@/lib/auth/supabase-server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const rep = await getCurrentRep();
  if (!rep) return { error: "not authenticated" as const, status: 401 };
  if (rep.role !== "admin" && rep.role !== "founder") return { error: "not admin" as const, status: 403 };
  return { rep };
}

function adminClient() {
  return createAdminClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

// POST: invite a new user OR update an existing one
//   body: { action: 'invite' | 'update' | 'deactivate' | 'reactivate', ... }
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json().catch(() => ({}));
  const { action } = body;
  const url = new URL(req.url);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || `${url.protocol}//${url.host}`;

  if (action === "invite") {
    const { email, full_name, role, phone, assignments } = body;
    if (!email || !full_name || !role) return NextResponse.json({ error: "email, full_name, role required" }, { status: 400 });
    if (!["sales", "founder", "admin"].includes(role)) return NextResponse.json({ error: "invalid role" }, { status: 400 });

    const admin = adminClient();
    const lower = String(email).trim().toLowerCase();

    // Try invite, fall back to generateLink on rate limit
    let userId: string | null = null;
    let inviteLink: string | null = null;

    const { data: invData, error: invErr } = await admin.auth.admin.inviteUserByEmail(lower, {
      redirectTo: `${siteUrl}/auth/reset-password`,
      data: { full_name, role },
    });
    if (invErr) {
      const msg = (invErr.message || "").toLowerCase();
      if (/already.*exist|already.*registered|already invited/.test(msg)) {
        const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
        userId = list?.users?.find(x => (x.email || "").toLowerCase() === lower)?.id ?? null;
      } else if (/rate limit/.test(msg)) {
        const { data: linkData } = await admin.auth.admin.generateLink({
          type: "invite", email: lower,
          options: { redirectTo: `${siteUrl}/auth/reset-password` },
        });
        userId = linkData?.user?.id ?? null;
        inviteLink = linkData?.properties?.action_link ?? null;
      } else {
        return NextResponse.json({ error: invErr.message }, { status: 500 });
      }
    } else {
      userId = invData?.user?.id ?? null;
    }
    if (!userId) return NextResponse.json({ error: "failed to create user" }, { status: 500 });

    // Always generate a recovery link too (so admin can hand-deliver)
    let setPasswordLink: string | null = null;
    try {
      const { data: ld } = await admin.auth.admin.generateLink({
        type: "recovery", email: lower,
        options: { redirectTo: `${siteUrl}/auth/reset-password` },
      });
      setPasswordLink = ld?.properties?.action_link ?? null;
    } catch { /* non-fatal */ }

    // Upsert sales_reps row
    await admin.from("sales_reps").upsert({
      id: userId, email: lower, full_name, phone: phone || null, role, active: true,
    }, { onConflict: "id" });

    // Optional: insert rep_assignments
    if (Array.isArray(assignments)) {
      for (const a of assignments) {
        if (!a.product_code || !a.incentive_inr) continue;
        await admin.from("rep_assignments").insert({
          rep_id: userId,
          product_code: a.product_code,
          edition_match: a.edition_match || null,
          edition_label: a.edition_label || null,
          incentive_inr: a.incentive_inr,
          notes: a.notes || null,
          active: true,
        });
      }
    }

    return NextResponse.json({ ok: true, user_id: userId, set_password_link: setPasswordLink, invite_link: inviteLink });
  }

  if (action === "update") {
    const { id, full_name, phone, role } = body;
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const updates: any = {};
    if (full_name !== undefined) updates.full_name = full_name;
    if (phone !== undefined) updates.phone = phone;
    if (role !== undefined) {
      if (!["sales", "founder", "admin"].includes(role)) return NextResponse.json({ error: "invalid role" }, { status: 400 });
      updates.role = role;
    }
    const { error } = await supabase.from("sales_reps").update(updates).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action === "deactivate" || action === "reactivate") {
    const { id } = body;
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const active = action === "reactivate";
    const { error } = await supabase.from("sales_reps").update({ active }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, active });
  }

  if (action === "send_password_link") {
    const { id, email } = body;
    if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });
    const admin = adminClient();
    const { data, error } = await admin.auth.admin.generateLink({
      type: "recovery", email: String(email).toLowerCase(),
      options: { redirectTo: `${siteUrl}/auth/reset-password` },
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, set_password_link: data?.properties?.action_link });
  }

  return NextResponse.json({ error: `unknown action '${action}'` }, { status: 400 });
}
