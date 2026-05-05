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

// Pages a sales rep is ALLOWED to visit. Anything else they get redirected.
const SALES_ALLOWED = ["/queue", "/leads", "/leaderboard", "/login", "/auth"];

// Public — no auth check at all
const PUBLIC_PREFIXES = [
  "/login", "/auth",
  "/api/webhook/",       // Tally / Razorpay / Calendly webhooks
  "/api/debug/",         // diagnostic endpoints
  "/api/maintenance/",   // one-off bulk ops (gated by env, ok for now)
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

  // Logged in — fetch role from sales_reps
  const { data: rep } = await supabase
    .from("sales_reps")
    .select("role,active")
    .eq("id", user.id)
    .maybeSingle();

  if (!rep || !rep.active) {
    // Auth user exists but no rep row, or deactivated → kick to login w/ message
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("error", "no_access");
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
