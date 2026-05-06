import Header from "@/components/Header";
import { SkeletonBlock, SkeletonCard } from "@/components/SkeletonRow";

export default function InsightsLoading() {
  return (
    <>
      <Header />
      <main className="max-w-[1500px] mx-auto px-6 py-6">
        <SkeletonBlock className="h-9 w-72 mb-2" />
        <SkeletonBlock className="h-4 w-96 mb-6" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} rows={2} />)}
        </div>
        <SkeletonCard rows={6} className="mb-6" />
        <SkeletonCard rows={6} />
      </main>
    </>
  );
}
