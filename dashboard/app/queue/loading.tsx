import Header from "@/components/Header";
import { SkeletonBlock, SkeletonCard, SkeletonRow } from "@/components/SkeletonRow";

// Shows for ~50ms while /queue's server render is in flight. Mirrors the
// final layout so the page doesn't visibly shift when the real data arrives.
export default function QueueLoading() {
  return (
    <>
      <Header />
      <main className="max-w-[1500px] mx-auto px-6 py-6">
        <SkeletonCard rows={3} className="mb-5" />
        <SkeletonCard rows={2} className="mb-5" />
        <SkeletonCard rows={3} className="mb-5" />
        <div className="surface-card overflow-hidden">
          <SkeletonBlock className="h-12 m-3" />
          {Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} cols={6} />)}
        </div>
      </main>
    </>
  );
}
