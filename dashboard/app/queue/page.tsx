import Header from "@/components/Header";
import { fetchLeads } from "@/lib/supabase";
import QueueClient from "@/components/QueueClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function QueuePage() {
  // Pre-fetch the working set: top 1500 by score covers every meaningful candidate
  // for today's queue. Ranking + grouping happens client-side for instant interaction.
  const leads = await fetchLeads({ limit: 1500 });

  return (
    <>
      <Header />
      <main className="max-w-[1500px] mx-auto px-6 py-6">
        <QueueClient initialLeads={leads} />
      </main>
    </>
  );
}
