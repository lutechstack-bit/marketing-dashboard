import Header from "@/components/Header";
import { getLeadDetail } from "@/lib/supabase";
import LeadDetailClient from "@/components/LeadDetailClient";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getLeadDetail(id);

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
        <LeadDetailClient detail={detail} />
      </main>
    </>
  );
}
