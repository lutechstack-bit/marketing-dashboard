import Header from "@/components/Header";
import { getLeadDetail } from "@/lib/supabase";
import { fetchBookingsCached, indexByEmail } from "@/lib/calendly";
import { aiWhyHotCached } from "@/lib/ai-insights";
import LeadDetailClient from "@/components/LeadDetailClient";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getLeadDetail(id);

  // Run Calendly + AI in parallel — both are cached so 99% of loads are instant.
  const [bookings, aiBrief] = await Promise.all([
    (async () => {
      if (!detail.lead?.email) return [];
      try {
        const all = await fetchBookingsCached(60);
        return indexByEmail(all)[detail.lead.email.toLowerCase()] || [];
      } catch (e: any) {
        console.error("[lead-detail] Calendly fetch failed:", e?.message);
        return [];
      }
    })(),
    (async () => {
      if (!detail.lead) return null;
      try {
        return await aiWhyHotCached(detail.lead, detail.submissions);
      } catch (e: any) {
        console.error("[lead-detail] AI brief failed:", e?.message);
        return null;
      }
    })(),
  ]);

  if (!detail.lead) {
    return (
      <>
        <Header />
        <main className="max-w-[1200px] mx-auto px-6 py-12">
          <Link href="/leads" className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg-text mb-6">
            <ChevronLeft className="w-4 h-4" />Back to leads
          </Link>
          <div className="surface-card p-8 text-center">
            <h1 className="text-xl font-semibold mb-2 text-fg-text">Lead not found</h1>
            <p className="text-sm text-fg-muted">This lead doesn&apos;t exist, or has been removed.</p>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <Header />
      <main className="max-w-[1200px] mx-auto px-6 py-6">
        <Link href="/leads" className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg-text mb-4">
          <ChevronLeft className="w-4 h-4" />Back to leads
        </Link>
        <LeadDetailClient detail={detail} calendlyBookings={bookings} aiBrief={aiBrief} />
      </main>
    </>
  );
}
