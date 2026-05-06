import Header from "@/components/Header";
import { SkeletonBlock, SkeletonCard } from "@/components/SkeletonRow";

export default function LeadDetailLoading() {
  return (
    <>
      <Header />
      <main className="max-w-[1200px] mx-auto px-6 py-6">
        <SkeletonBlock className="h-4 w-32 mb-4" />
        <SkeletonCard rows={4} className="mb-5" />
        <SkeletonCard rows={5} className="mb-5" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
          <SkeletonCard rows={4} />
          <SkeletonCard rows={4} />
        </div>
        <SkeletonCard rows={6} />
      </main>
    </>
  );
}
