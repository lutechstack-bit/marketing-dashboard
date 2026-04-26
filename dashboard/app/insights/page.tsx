import Header from "@/components/Header";
import { fetchLeads, supabase } from "@/lib/supabase";
import { loadAll } from "@/lib/data";
import InsightsClient from "@/components/InsightsClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

export default async function InsightsPage() {
  // Pull leads, marketing data, payments, and rep activities in parallel
  const [leads, sheetData, paymentsRes, activitiesRes] = await Promise.all([
    fetchLeads({ limit: 10000 }),
    loadAll().catch((e) => {
      console.error("[insights] sheet load failed:", e?.message);
      return null;
    }),
    supabase
      .from("payments")
      .select("paid_at,amount_inr,status,program,payment_type")
      .eq("status", "captured")
      .order("paid_at", { ascending: false })
      .limit(5000),
    supabase
      .from("lead_activities")
      .select("rep_name,lead_id,action,created_at")
      .order("created_at", { ascending: false })
      .limit(5000),
  ]);

  const payments = (paymentsRes.data || []) as any[];
  const activities = (activitiesRes.data || []) as any[];

  return (
    <>
      <Header />
      <main className="max-w-[1500px] mx-auto px-6 py-6">
        <InsightsClient
          initialLeads={leads}
          payments={payments}
          activities={activities}
          marketingMonthly={sheetData?.monthly || []}
          marketingDaily={sheetData?.spendTrend || []}
        />
      </main>
    </>
  );
}
