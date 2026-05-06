// Reusable skeleton primitives for loading states. Animated with a subtle
// shimmer that respects the current theme (works in light + dark).

export function SkeletonBlock({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded bg-fg-surface ${className}`}
      aria-hidden
    />
  );
}

export function SkeletonRow({ cols = 5 }: { cols?: number }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-fg-border/40">
      <SkeletonBlock className="w-8 h-8 rounded-md" />
      {Array.from({ length: cols }).map((_, i) => (
        <SkeletonBlock key={i} className={`h-4 ${i === 0 ? "w-32" : i === 1 ? "w-40" : "flex-1"}`} />
      ))}
    </div>
  );
}

export function SkeletonCard({ rows = 4, className = "" }: { rows?: number; className?: string }) {
  return (
    <div className={`surface-card p-5 ${className}`}>
      <SkeletonBlock className="h-5 w-40 mb-4" />
      <div className="space-y-2.5">
        {Array.from({ length: rows }).map((_, i) => (
          <SkeletonBlock key={i} className={`h-3 ${i % 2 === 0 ? "w-full" : "w-2/3"}`} />
        ))}
      </div>
    </div>
  );
}
