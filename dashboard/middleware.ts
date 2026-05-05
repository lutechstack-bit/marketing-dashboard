// Auth middleware — runs on every request. Refreshes the session cookie and
// gates routes by role (sales / founder / admin).
//
// Sales reps can access:    /queue, /leads, /leads/[id], /leaderboard
// Founders+admins access:   everything above + /, /insights, /admin/*
// Anonymous users:          redirected to /login
//
// Public routes:            /login, /api/webhook/*, /api/debug/*, static assets

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

// Pages a sales rep is ALLOWED to visit. Anything else they get redirected.
const SALES_ALLOWED = ["/queue", "/leads", "/leaderboard", "/login", "/auth"];

// Public — no auth check at all
const PUBLIC_PREFIXES = [
  "/login", "/auth",
  "/api/auth/signup",                 // self-signup (rate-limited, creates inactive user)
  "/api/webhook/",                    // Tally / Razorpay / Calendly webhooks
  "/api/debug/",                      // diagnostic endpoints
  "/api/maintenance/",                // one-off bulk ops (gated by env)
  "/api/admin/invite-users",          // bootstrap (gated by ADMIN_BOOTSTRAP_TOKEN)
  "/_next/", "/favicon", "/static/",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some(p => pathname.startsWith(p));
}

export async function middleware(req: NextRequest) {
  let response = NextResponse.next({ request: req });
  const pathname = req.nextUrl.pathname;

  // If auth env vars aren't configured yet, run as if there's no auth gate.
  // This keeps the site functional until the operator finishes setup.
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return response;
  }

  if (isPublic(pathname)) return response;

  // Build a Supabase client wired to the response cookies so session refresh persists
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return req.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value));
          response = NextResponse.next({ request: req });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: don't introduce code between createServerClient and getUser.
  // It can break the session refresh.
  const { data: { user } } = await supabase.auth.getUser();

  // Not logged in → push to /login (unless they're already there)
  if (!user) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Logged in — fetch role from sales_reps. Use the service-role key to
  // bypass RLS (the user is already authenticated via the cookie client above;
  // we just need to look up their role/active flag).
  let rep: { role: string; active: boolean } | null = null;
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const admin = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { data } = await admin
      .from("sales_reps")
      .select("role,active")
      .eq("id", user.id)
      .maybeSingle();
    rep = data as any;
  } else {
    // Fallback: anon-key client (will fail silently if RLS blocks it)
    const { data } = await supabase
      .from("sales_reps")
      .select("role,active")
      .eq("id", user.id)
      .maybeSingle();
    rep = data as any;
  }

  if (!rep || !rep.active) {
    // Sign them out so the next attempt is clean — otherwise they're stuck in a
    // logged-in-but-blocked loop.
    await supabase.auth.signOut();
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    // Differentiate: rep row exists but inactive = pending admin approval.
    // No rep row at all = an orphan auth user (shouldn't happen via /signup but
    // could happen if admin deletes the row manually).
    url.searchParams.set("error", rep ? "pending_approval" : "no_access");
    return NextResponse.redirect(url);
  }

  const role = rep.role as "sales" | "founder" | "admin";

  // Sales reps can only access whitelisted prefixes
  if (role === "sales") {
    const allowed = SALES_ALLOWED.some(p => pathname.startsWith(p))
      || pathname === "/" /* will redirect below */
      || pathname.startsWith("/api/activities")  // status dropdown
      || pathname.startsWith("/api/ai/");        // AI brief on lead detail
    if (pathname === "/" || pathname.startsWith("/insights") || pathname.startsWith("/admin")) {
      // Redirect sales away from founder/admin pages
      const url = req.nextUrl.clone();
      url.pathname = "/queue";
      return NextResponse.redirect(url);
    }
    if (!allowed) {
      const url = req.nextUrl.clone();
      url.pathname = "/queue";
      return NextResponse.redirect(url);
    }
  }

  // Founders can access everything except /admin pages (admins only)
  if (role === "founder" && pathname.startsWith("/admin")) {
    // For now founders get admin too — change this branch if you want to split
    // (kept permissive per founder request: "founders + management get admin")
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
