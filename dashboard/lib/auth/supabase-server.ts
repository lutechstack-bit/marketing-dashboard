// Supabase server client — for use inside Server Components, Route Handlers,
// and middleware. Reads/writes auth cookies via Next.js's cookies() API.

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

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
    const { data: rep } = await supabase
      .from("sales_reps")
      .select("id,email,full_name,role,active")
      .eq("id", user.id)
      .maybeSingle();
    return rep as any;
  } catch {
    return null;
  }
}
