import Header from "@/components/Header";
import { fetchLeads } from "@/lib/supabase";
import { fetchBookingsCached, indexByEmail } from "@/lib/calendly";
import { getCurrentRep } from "@/lib/auth/supabase-server";
import EarningsHeader from "@/components/EarningsHeader";
import QueueClient from "@/components/QueueClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;
// Calendly fetch can run 5-15s; bump beyond Hobby's 10s default.
export const maxDuration = 60;

export default async function QueuePage() {
  // Lead fetch and Calendly fetch in parallel.
  // Calendly window kept tight (45 days) so the page load stays under ~8s.
  const [leads, bookings] = await Promise.all([
    fetchLeads({ limit: 1500 }),
    fetchBookingsCached(45).catch((e) => {
      console.error("[queue] Calendly fetch failed:", e?.message, e?.stack?.split("\n")[0]);
      return [];
    }),
  ]);
  console.log(`[queue] leads=${leads.length} calendly_bookings=${bookings.length}`);

  const bookingIdx = indexByEmail(bookings);
  // Set of emails that have an ACTIVE (non-canceled) booking — used by the queue
  // to know who's already booked an interview.
  const bookedEmails = new Set(
    Object.entries(bookingIdx)
      .filter(([_, bs]) => bs.some(b => b.status !== "canceled"))
      .map(([email]) => email)
  );

  // Logged-in rep — drives EarningsHeader (sales reps only) and the per-rep filter
  const currentRep = await getCurrentRep();

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
        />
      </main>
    </>
  );
}
