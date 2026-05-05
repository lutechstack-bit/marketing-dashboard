// Supabase server client — for use inside Server Components, Route Handlers,
// and middleware. Reads/writes auth cookies via Next.js's cookies() API.

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/**
 * Privileged server-only client for reads that need to bypass RLS — e.g.
 * looking up sales_reps role/active for an authenticated user. Never expose
 * this to the browser. Used only after we've already authenticated the user
 * via the cookie-based client.
 */
function adminClient() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

export function isAuthConfigured(): boolean {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export async function createSupabaseServerClient() {
  if (!isAuthConfigured()) {
    throw new Error("Auth not configured — NEXT_PUBLIC_SUPABASE_ANON_KEY missing");
  }
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server Components can't set cookies — middleware/route handlers can.
            // Safe to swallow; the middleware will refresh the session.
          }
        },
      },
    }
  );
}

/** Server-side helper: get the currently logged-in sales_rep row (or null). */
export async function getCurrentRep(): Promise<{
  id: string;
  email: string;
  full_name: string | null;
  role: "sales" | "founder" | "admin";
  active: boolean;
} | null> {
  if (!isAuthConfigured()) return null; // pre-bootstrap state
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    // Use the service-role client for the rep lookup so RLS doesn't block it.
    // Safe: we've already authenticated the user via the cookie session above.
    const admin = adminClient();
    const { data: rep } = await admin
      .from("sales_reps")
      .select("id,email,full_name,role,active")
      .eq("id", user.id)
      .maybeSingle();
    return rep as any;
  } catch {
    return null;
  }
}
