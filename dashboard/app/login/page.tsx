import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { redirect } from "next/navigation";
import LoginForm from "@/components/auth/LoginForm";
import ForgeWordmark, { ForgeWave } from "@/components/ForgeWordmark";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const params = await searchParams;
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
    <main className="min-h-screen flex items-center justify-center bg-forge-cream relative overflow-hidden p-6">
      {/* Decorative orange/yellow blobs */}
      <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-forge-yellow opacity-20 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 -right-32 w-96 h-96 rounded-full bg-forge-orange opacity-15 blur-3xl pointer-events-none" />

      <div className="w-full max-w-sm relative">
        <div className="text-center mb-8">
          <div className="inline-flex w-14 h-14 rounded-2xl bg-forge-gradient items-center justify-center shadow-soft mb-4">
            <span className="font-display font-extrabold italic text-forge-black text-2xl leading-none">F</span>
          </div>
          <div className="flex justify-center mb-2">
            <ForgeWordmark size="lg" />
          </div>
          <ForgeWave className="mx-auto w-16 h-3 mb-3" />
          <p className="text-sm text-fg-muted">Sales Intelligence · Sign in to continue</p>
        </div>
        <LoginForm initialError={params.error} />
        <div className="mt-6 text-xs text-fg-subtle text-center">
          Trouble signing in? Ask an admin for an invite.
        </div>
      </div>
    </main>
  );
}
