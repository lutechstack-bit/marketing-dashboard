import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { redirect } from "next/navigation";
import LoginForm from "@/components/auth/LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const params = await searchParams;
  // If already logged in, redirect to wherever they came from (or root)
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const { data: rep } = await supabase.from("sales_reps").select("role,active").eq("id", user.id).maybeSingle();
    if (rep?.active) {
      const dest = params.next || (rep.role === "sales" ? "/queue" : "/");
      redirect(dest);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-amber-50/40 via-white to-cyan-50/30 p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-amber-700 items-center justify-center font-bold text-white shadow-md mb-3">L</div>
          <h1 className="text-2xl font-bold tracking-tight text-fg-text">LevelUp Sales Intelligence</h1>
          <p className="text-sm text-fg-muted mt-1">Sign in to continue</p>
        </div>
        <LoginForm initialError={params.error} />
        <div className="mt-6 text-xs text-fg-subtle text-center">
          Trouble signing in? Ask Hiresh or admin@leveluplearning.in to send you an invite.
        </div>
      </div>
    </main>
  );
}
