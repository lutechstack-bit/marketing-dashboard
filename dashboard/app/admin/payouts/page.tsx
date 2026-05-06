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
  // We pull leads ONLY for the rows that have earnings (so the table can show
  // the lead's name next to each earning). The modal uses /api/admin/lead-search
  // for server-side search across the full 41k+ leads — no need to load them all.
  const [earningsRes, repsRes, assignmentsRes] = await Promise.all([
    supabase.from("incentive_earnings")
      .select("*")
      .or(`status.eq.locked,status.eq.unlocked,status.eq.approved,and(status.eq.paid_out,paid_out_at.gte.${ninetyDaysAgo}),and(status.eq.reverted,reverted_at.gte.${ninetyDaysAgo})`)
      .order("locked_at", { ascending: false })
      .limit(500),
    supabase.from("sales_reps").select("id,full_name,email,role,active").eq("active", true),
    supabase.from("rep_assignments").select("rep_id,product_code,edition_match,edition_label,incentive_inr").eq("active", true),
  ]);

  const earnings = (earningsRes.data || []) as any[];
  const reps = (repsRes.data || []) as any[];
  const assignments = (assignmentsRes.data || []) as any[];
  const repsById = Object.fromEntries(reps.map((r: any) => [r.id, r]));

  // Fetch JUST the leads referenced by these earnings, in chunks of 200 ids.
  const leadIds = Array.from(new Set(earnings.map((e: any) => e.lead_id).filter(Boolean)));
  const leadsById: Record<string, any> = {};
  for (let i = 0; i < leadIds.length; i += 200) {
    const chunk = leadIds.slice(i, i + 200);
    const { data } = await supabase
      .from("leads")
      .select("id,name,email,phone,program,funnel_stage")
      .in("id", chunk);
    for (const l of (data || []) as any[]) leadsById[l.id] = l;
  }

  return (
    <>
      <Header />
      <main className="max-w-[1400px] mx-auto px-6 py-6">
        <PayoutsClient
          earnings={earnings}
          repsById={repsById}
          leadsById={leadsById}
          reps={reps}
          assignments={assignments}
        />
      </main>
    </>
  );
}
