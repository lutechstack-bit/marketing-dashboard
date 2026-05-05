// Self-signup endpoint — creates an auth user + an inactive sales_reps row.
// The user is created in `pending` state (active=false, role=sales by default);
// an admin then reviews them in /admin/team and approves + assigns role +
// products. Until that happens, middleware bounces them to
// /login?error=pending_approval.
//
// Security model:
// · No email verification needed (admin Service Role Key creates the auth user
//   with email_confirm:true so they can sign in immediately) — but the active
//   flag gates real access.
// · Light rate-limit: per-email + per-IP we throttle to 5 signups/hour.
// · Optional domain allowlist via env (SIGNUP_ALLOWED_DOMAINS=leveluplearning.in,...).
//   Empty/unset means all domains accepted.

import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function adminClient() {
  return createAdminClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

// Simple in-memory rate limiter — fine for our scale (single Vercel instance
// usually handles all traffic, and we'd rather lose a few rate-limit hits on
// cold start than build a full Redis dep just for signup).
const recentByKey = new Map<string, number[]>();
function isRateLimited(key: string, max = 5, windowMs = 60 * 60_000): boolean {
  const now = Date.now();
  const arr = (recentByKey.get(key) || []).filter(t => now - t < windowMs);
  if (arr.length >= max) { recentByKey.set(key, arr); return true; }
  arr.push(now);
  recentByKey.set(key, arr);
  return false;
}

export async function POST(req: Request) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Auth not configured" }, { status: 500 });
  }

  const body = await req.json().catch(() => ({}));
  const emailRaw = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const fullName = String(body.full_name || "").trim();

  // Basic validation
  if (!emailRaw || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }
  if (!fullName || fullName.length < 2) {
    return NextResponse.json({ error: "Enter your full name." }, { status: 400 });
  }

  // Optional domain allowlist
  const allowedDomains = (process.env.SIGNUP_ALLOWED_DOMAINS || "")
    .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  if (allowedDomains.length > 0) {
    const domain = emailRaw.split("@")[1];
    if (!allowedDomains.includes(domain)) {
      return NextResponse.json(
        { error: `Sign-ups are restricted to: ${allowedDomains.join(", ")}.` },
        { status: 403 },
      );
    }
  }

  // Rate-limit per email and per IP — 5 attempts per hour each
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
          || req.headers.get("x-real-ip")
          || "unknown";
  if (isRateLimited(`email:${emailRaw}`) || isRateLimited(`ip:${ip}`)) {
    return NextResponse.json({ error: "Too many sign-up attempts. Try again in an hour." }, { status: 429 });
  }

  const admin = adminClient();

  // If a sales_rep already exists for this email, block — they should sign in or
  // ask admin for a recovery link.
  const { data: existingRep } = await admin
    .from("sales_reps")
    .select("id,active")
    .eq("email", emailRaw)
    .maybeSingle();

  if (existingRep) {
    return NextResponse.json({
      error: existingRep.active
        ? "An account with this email already exists. Try signing in instead."
        : "Your account already exists and is awaiting admin approval.",
    }, { status: 409 });
  }

  // Create the auth user — email_confirm:true means they don't need to click a
  // verification email; they can sign in straight away (and immediately hit the
  // pending_approval gate).
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: emailRaw,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (createErr) {
    const msg = (createErr.message || "").toLowerCase();
    if (/already.*registered|already.*exists/.test(msg)) {
      return NextResponse.json({
        error: "An account with this email already exists. Try signing in or use 'Forgot password'.",
      }, { status: 409 });
    }
    return NextResponse.json({ error: createErr.message }, { status: 500 });
  }

  const userId = created?.user?.id;
  if (!userId) return NextResponse.json({ error: "Failed to create account" }, { status: 500 });

  // Insert the sales_reps row in pending state. Default role=sales — admin can
  // promote to founder/admin during approval.
  const { error: insertErr } = await admin.from("sales_reps").insert({
    id: userId,
    email: emailRaw,
    full_name: fullName,
    role: "sales",
    active: false,
  });

  if (insertErr) {
    // Don't leave a dangling auth user — clean up.
    try { await admin.auth.admin.deleteUser(userId); } catch { /* swallow */ }
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, user_id: userId });
}
