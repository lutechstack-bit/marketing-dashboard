import Header from "@/components/Header";
import { fetchLeads } from "@/lib/supabase";
import { fetchBookings, indexByEmail } from "@/lib/calendly";
import QueueClient from "@/components/QueueClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function QueuePage() {
  // Run lead + booking fetches in parallel — Calendly takes ~3-5s for ~150 events.
  const [leads, bookings] = await Promise.all([
    fetchLeads({ limit: 1500 }),
    fetchBookings(90).catch((e) => {
      console.error("Calendly fetch failed:", e?.message);
      return [];
    }),
  ]);

  const bookingIdx = indexByEmail(bookings);
  // Set of emails that have an ACTIVE (non-canceled) booking — used by the queue
  // to know who's already booked an interview.
  const bookedEmails = new Set(
    Object.entries(bookingIdx)
      .filter(([_, bs]) => bs.some(b => b.status !== "canceled"))
      .map(([email]) => email)
  );

  return (
    <>
      <Header />
      <main className="max-w-[1500px] mx-auto px-6 py-6">
        <QueueClient
          initialLeads={leads}
          bookedEmails={Array.from(bookedEmails)}
          calendlyConnected={bookings.length > 0}
        />
      </main>
    </>
  );
}
