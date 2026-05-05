import Header from "@/components/Header";
import { supabase } from "@/lib/supabase";
import { getCurrentRep } from "@/lib/auth/supabase-server";
import { redirect } from "next/navigation";
import PayoutsClient from "@/components/admin/PayoutsClient";

export const dynamic = "force-dynamic";

export default async function PayoutsPage() {
  const rep = await getCurrentRep();
  if (!rep) redirect("/login?next=/admin/payouts");
  if (rep.role !== "admin" && rep.role !== "founder") redirect("/");

  // Fetch all earnings in non-final states + recent paid out (last 90d) for context
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400_000).toISOString();
  const [earningsRes, repsRes, leadsRes] = await Promise.all([
    supabase.from("incentive_earnings")
      .select("*")
      .or(`status.eq.locked,status.eq.unlocked,status.eq.approved,and(status.eq.paid_out,paid_out_at.gte.${ninetyDaysAgo}),and(status.eq.reverted,reverted_at.gte.${ninetyDaysAgo})`)
      .order("locked_at", { ascending: false })
      .limit(500),
    supabase.from("sales_reps").select("id,full_name,email,role"),
    supabase.from("leads").select("id,name,email,phone,program,funnel_stage").limit(10000),
  ]);

  const earnings = (earningsRes.data || []) as any[];
  const reps = (repsRes.data || []) as any[];
  const leads = (leadsRes.data || []) as any[];
  const repsById = Object.fromEntries(reps.map((r: any) => [r.id, r]));
  const leadsById = Object.fromEntries(leads.map((l: any) => [l.id, l]));

  return (
    <>
      <Header />
      <main className="max-w-[1400px] mx-auto px-6 py-6">
        <PayoutsClient
          earnings={earnings}
          repsById={repsById}
          leadsById={leadsById}
        />
      </main>
    </>
  );
}
