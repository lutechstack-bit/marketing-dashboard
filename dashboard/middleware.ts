// Auth middleware — runs on every request. Refreshes the session cookie and
// gates routes by role (sales / founder / admin).
//
// Sales reps can access:    /queue, /leads, /leads/[id], /leaderboard
// Founders+admins access:   everything above + /, /insights, /admin/*
// Anonymous users:          redirected to /login
//
// Public routes:            /login, /api/webhook/*, /api/debug/*, static assets
//
// Implementation note: this runs on the Vercel Edge runtime where supabase-js
// can be flaky. The role lookup uses raw fetch() against PostgREST instead of
// supabase-js — it's a single HTTP call and gives us reliable diagnostics.

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const SALES_ALLOWED = ["/queue", "/leads", "/leaderboard", "/login", "/auth"];

const PUBLIC_PREFIXES = [
  "/login", "/auth",
  "/api/auth/signup",
  "/api/webhook/",
  "/api/debug/",
  "/api/maintenance/",
  "/api/admin/invite-users",
  "/_next/", "/favicon", "/static/",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some(p => pathname.startsWith(p));
}

/**
 * Look up sales_reps by id using raw PostgREST + service-role key.
 * Bypasses RLS. Returns null on any error or if no row is found, plus a
 * diagnostic string we can pin to the redirect URL or response header.
 */
async function fetchRep(userId: string): Promise<{
  rep: { role: string; active: boolean } | null;
  diag: string;
}> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { rep: null, diag: "missing_env" };

  try {
    const r = await fetch(
      `${url}/rest/v1/sales_reps?id=eq.${encodeURIComponent(userId)}&select=role,active`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          Accept: "application/json",
        },
      },
    );
    if (!r.ok) {
      return { rep: null, diag: `pg_${r.status}` };
    }
    const arr = (await r.json()) as Array<{ role: string; active: boolean }>;
    if (!Array.isArray(arr) || arr.length === 0) {
      return { rep: null, diag: "no_row" };
    }
    return { rep: arr[0], diag: "ok" };
  } catch (e: any) {
    return { rep: null, diag: `fetch_err:${(e?.message || "unknown").slice(0, 40)}` };
  }
}

export async function middleware(req: NextRequest) {
  let response = NextResponse.next({ request: req });
  const pathname = req.nextUrl.pathname;

  // Pre-bootstrap: no auth env → run unguarded
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return response;
  }
  if (isPublic(pathname)) return response;

  // Cookie-based client for session refresh
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
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: don't introduce code between createServerClient and getUser.
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Look up role via raw fetch (Edge-safe, RLS-bypassing)
  const { rep, diag } = await fetchRep(user.id);

  // Surface the diagnostic in the response header so we can verify the lookup
  // is working without redeploying. Read with: curl -I https://.../some-page
  response.headers.set("x-mw-rep-diag", diag);

  if (!rep || !rep.active) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    // Pin the diagnostic to the URL so it's visible in the browser too
    url.searchParams.set("error", rep ? "pending_approval" : "no_access");
    if (diag !== "ok" && diag !== "no_row") url.searchParams.set("diag", diag);
    return NextResponse.redirect(url);
  }

  const role = rep.role as "sales" | "founder" | "admin";
  response.headers.set("x-mw-role", role);

  // Sales reps: only whitelisted prefixes
  if (role === "sales") {
    if (pathname === "/" || pathname.startsWith("/insights") || pathname.startsWith("/admin")) {
      const url = req.nextUrl.clone();
      url.pathname = "/queue";
      return NextResponse.redirect(url);
    }
    const allowed = SALES_ALLOWED.some(p => pathname.startsWith(p))
      || pathname.startsWith("/api/activities")
      || pathname.startsWith("/api/ai/");
    if (!allowed) {
      const url = req.nextUrl.clone();
      url.pathname = "/queue";
      return NextResponse.redirect(url);
    }
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
