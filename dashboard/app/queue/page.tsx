import Header from "@/components/Header";
import { fetchLeads, supabase } from "@/lib/supabase";
import { fetchLeadsStats } from "@/lib/leads-stats";
import { fetchBookingsCached, indexByEmail } from "@/lib/calendly";
import { getCurrentRep } from "@/lib/auth/supabase-server";
import EarningsHeader from "@/components/EarningsHeader";
import QueueClient from "@/components/QueueClient";
import TasksPanel from "@/components/TasksPanel";
import RefreshButton from "@/components/RefreshButton";
import TodaysProgress from "@/components/TodaysProgress";
import MoneyOnTheTable from "@/components/MoneyOnTheTable";
import TopOpportunities from "@/components/TopOpportunities";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

export default async function QueuePage() {
  const currentRep = await getCurrentRep();

  // Load each bucket independently so each gets guaranteed representation.
  // Previously we did a single fetchLeads with all three stages at limit 5000:
  // when many imported leads share the same last_activity (today's import
  // time), ties broke by score DESC — partials (score ~0) lost to submitted
  // (score 30+) every time, leaving 0 partials in the slice.
  //
  // Three parallel queries × per-bucket limits = guaranteed coverage.
  const [partialLeads, submittedLeads, paidLeads, leadsStats, bookings, earningsRes] = await Promise.all([
    fetchLeads({
      limit: 1500,
      stages: ["form_partial"],
      enrichments: ["activities"],
      sort: "recent",
    }),
    fetchLeads({
      limit: 3000,
      stages: ["form_submitted"],
      enrichments: ["activities"],
      sort: "recent",
    }),
    fetchLeads({
      limit: 1500,
      stages: ["app_fee_paid"],
      enrichments: ["activities"],
      sort: "recent",
    }),
    fetchLeadsStats({ family: "all", period: "all" }),
    fetchBookingsCached(45).catch(() => []),
    // For sales reps, only their earnings; admins/founders see everyone's
    (async () => {
      let q = supabase
        .from("incentive_earnings")
        .select("id,lead_id,rep_id,amount_inr,status,locked_at,unlocked_at,approved_at,paid_out_at,reverted_at")
        .neq("status", "reverted")
        .limit(2000);
      if (currentRep?.role === "sales") q = q.eq("rep_id", currentRep.id);
      const { data } = await q;
      return (data || []) as any[];
    })(),
  ]);

  // Merge per-bucket loads into a single leads list for QueueClient
  const leads = [...partialLeads, ...submittedLeads, ...paidLeads];

  const bookingIdx = indexByEmail(bookings);
  const bookedEmails = new Set(
    Object.entries(bookingIdx)
      .filter(([_, bs]) => bs.some(b => b.status !== "canceled"))
      .map(([email]) => email)
  );

  // Index earnings by lead_id (most recent if multiple)
  const earningsByLead: Record<string, any> = {};
  for (const e of earningsRes) {
    if (!e.lead_id) continue;
    const existing = earningsByLead[e.lead_id];
    // Prefer non-final status; otherwise the latest
    const t1 = e.locked_at || e.unlocked_at || e.approved_at || e.paid_out_at || "0";
    const t0 = existing ? (existing.locked_at || existing.unlocked_at || existing.approved_at || existing.paid_out_at || "0") : "0";
    if (!existing || t1 > t0) earningsByLead[e.lead_id] = e;
  }

  // Build a small leadsById map for TasksPanel so it can render name/phone
  // alongside each task. Only includes the leads currently loaded into the
  // queue — task rows for leads outside this slice fall back to a stub.
  const leadsById: Record<string, { id: string; name: string | null; email: string | null; phone: string | null; program: string | null }> = {};
  for (const l of leads) leadsById[l.id] = { id: l.id, name: l.name, email: l.email, phone: l.phone, program: l.program };

  return (
    <>
      <Header />
      <main className="max-w-[1500px] mx-auto px-6 py-6">
        <div className="flex items-center justify-end mb-3">
          <RefreshButton />
        </div>
        {currentRep && currentRep.role === "sales" && (
          <>
            <EarningsHeader repId={currentRep.id} repName={currentRep.full_name || currentRep.email.split("@")[0]} />
            <TodaysProgress repId={currentRep.id} repName={currentRep.full_name || currentRep.email.split("@")[0]} />
            <MoneyOnTheTable repId={currentRep.id} />
            <TopOpportunities repId={currentRep.id} />
          </>
        )}
        <TasksPanel leadsById={leadsById} />
        <QueueClient
          initialLeads={leads}
          bookedEmails={Array.from(bookedEmails)}
          calendlyConnected={bookings.length > 0}
          earningsByLead={earningsByLead}
          totalCounts={Object.fromEntries(Object.entries(leadsStats.by_program).map(([k, v]) => [k, v.by_stage]))}
        />
      </main>
    </>
  );
}
