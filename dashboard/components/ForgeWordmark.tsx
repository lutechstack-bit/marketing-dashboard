// Brand wordmark — "the Forge" in Playfair Display (Migra alternative)
// Used in the header and login screen.

export default function ForgeWordmark({ size = "md", subtitle = "by LevelUp Learning" }: { size?: "sm" | "md" | "lg"; subtitle?: string }) {
  const sizes = {
    sm: { the: "text-xs", forge: "text-base", subtitle: "text-[9px]" },
    md: { the: "text-sm", forge: "text-xl",   subtitle: "text-[10px]" },
    lg: { the: "text-base",forge: "text-3xl",  subtitle: "text-[11px]" },
  }[size];
  return (
    <div className="inline-flex items-baseline gap-1.5">
      <div className="flex flex-col items-end leading-none">
        <span className={`${sizes.the} text-forge-black/80 font-medium leading-tight`}>the</span>
        <span className={`${sizes.forge} font-display font-extrabold italic text-forge-black leading-none -mt-0.5`}>Forge</span>
      </div>
      {subtitle && (
        <span className={`${sizes.subtitle} text-forge-black/55 uppercase tracking-[0.18em] font-semibold ml-1 self-end pb-1`}>{subtitle}</span>
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
