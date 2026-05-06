import Header from "@/components/Header";
import { SkeletonBlock, SkeletonRow } from "@/components/SkeletonRow";

export default function LeadsLoading() {
  return (
    <>
      <Header />
      <main className="max-w-[1500px] mx-auto px-6 py-6">
        <div className="flex items-end justify-between gap-4 mb-5 flex-wrap">
          <div>
            <SkeletonBlock className="h-9 w-64 mb-2" />
            <SkeletonBlock className="h-4 w-80" />
          </div>
          <div className="flex gap-2.5">
            <SkeletonBlock className="h-12 w-32 rounded-lg" />
            <SkeletonBlock className="h-12 w-32 rounded-lg" />
            <SkeletonBlock className="h-12 w-24 rounded-lg" />
          </div>
        </div>
        <div className="surface-card overflow-hidden">
          {Array.from({ length: 12 }).map((_, i) => <SkeletonRow key={i} cols={5} />)}
        </div>
      </main>
    </>
  );
}
