// Brand wordmark — "LevelUp Learning · Sales Intelligence Dashboard".
// "LevelUp" is set in Playfair Display italic (the Forge brand display face);
// the rest is Open Sauce Sans for clean balance. The wordmark is theme-aware
// because it uses semantic color tokens (text-forge-black flips on dark).
//
// Sizes:
//   sm — header, compact
//   md — default
//   lg — login / hero
//
// `subtitle` defaults to "Sales Intelligence Dashboard" but can be overridden
// or hidden with `subtitle=""`.

export default function ForgeWordmark({
  size = "md",
  subtitle = "Sales Intelligence Dashboard",
}: { size?: "sm" | "md" | "lg"; subtitle?: string }) {
  const sizes = {
    sm: { brand: "text-base",  level: "text-sm",   subtitle: "text-[9px]" },
    md: { brand: "text-xl",    level: "text-lg",   subtitle: "text-[10px]" },
    lg: { brand: "text-3xl",   level: "text-2xl",  subtitle: "text-[11px]" },
  }[size];

  return (
    <div className="inline-flex flex-col items-start leading-tight">
      <div className="flex items-baseline gap-1.5">
        <span className={`font-display font-extrabold italic text-forge-black ${sizes.brand} leading-none`}>LevelUp</span>
        <span className={`font-semibold text-forge-black ${sizes.level} leading-none`}>Learning</span>
      </div>
      {subtitle && (
        <span className={`${sizes.subtitle} text-forge-black/60 uppercase tracking-[0.18em] font-semibold mt-1`}>
          {subtitle}
        </span>
      )}
    </div>
  );
}

/** Small wave decoration that pairs with the wordmark */
export function ForgeWave({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 80 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M0 8 Q10 0 20 8 T40 8 T60 8 T80 8" stroke="#FFBC3B" strokeWidth="2" strokeLinecap="round"/>
      <path d="M0 12 Q10 4 20 12 T40 12 T60 12 T80 12" stroke="#FFBC3B" strokeWidth="2" strokeLinecap="round" opacity="0.5"/>
    </svg>
  );
}
