import Header from "@/components/Header";
import { fetchLeads, fetchQueueCounts, supabase } from "@/lib/supabase";
import { fetchBookingsCached, indexByEmail } from "@/lib/calendly";
import { getCurrentRep } from "@/lib/auth/supabase-server";
import EarningsHeader from "@/components/EarningsHeader";
import QueueClient from "@/components/QueueClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

export default async function QueuePage() {
  const currentRep = await getCurrentRep();

  // Parallel fetch — only actionable stages + only the activities enrichment.
  // sort: "recent" so we pull the most recently active leads from EVERY
  // program/stage (instead of cherry-picking only the highest-scoring ones,
  // which previously squeezed out partials and small programs entirely).
  // Real per-bucket-per-program counts come from a separate aggregate query
  // (fetchQueueCounts) so the program tabs show the truth, not just what's
  // in the loaded slice.
  const [leads, queueCounts, bookings, earningsRes] = await Promise.all([
    // Top 5000 actionable leads by most-recent activity, across the THREE
    // queue buckets (partial / submitted / app_fee_paid). 'accepted' and
    // beyond don't belong in the queue. Combined with caching this is fast.
    fetchLeads({
      limit: 5000,
      stages: ["form_partial", "form_submitted", "app_fee_paid"],
      enrichments: ["activities"],
      sort: "recent",
    }),
    fetchQueueCounts(),
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

  return (
    <>
      <Header />
      <main className="max-w-[1500px] mx-auto px-6 py-6">
        {currentRep && currentRep.role === "sales" && (
          <EarningsHeader repId={currentRep.id} repName={currentRep.full_name || currentRep.email.split("@")[0]} />
        )}
        <QueueClient
          initialLeads={leads}
          bookedEmails={Array.from(bookedEmails)}
          calendlyConnected={bookings.length > 0}
          earningsByLead={earningsByLead}
          totalCounts={queueCounts}
        />
      </main>
    </>
  );
}
