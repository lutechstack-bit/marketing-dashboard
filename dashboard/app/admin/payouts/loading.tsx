import Header from "@/components/Header";
import { SkeletonBlock, SkeletonRow } from "@/components/SkeletonRow";

export default function PayoutsLoading() {
  return (
    <>
      <Header />
      <main className="max-w-[1400px] mx-auto px-6 py-6">
        <div className="flex items-end justify-between gap-3 mb-5 flex-wrap">
          <div>
            <SkeletonBlock className="h-9 w-64 mb-2" />
            <SkeletonBlock className="h-4 w-72" />
          </div>
          <SkeletonBlock className="h-10 w-56 rounded-md" />
        </div>
        <div className="flex gap-2 mb-4">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonBlock key={i} className="h-7 w-24 rounded-full" />)}
        </div>
        <div className="surface-card overflow-hidden">
          {Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} cols={6} />)}
        </div>
      </main>
    </>
  );
}
