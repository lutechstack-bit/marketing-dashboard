"use client";

import { useState } from "react";
import { LogOut, User2 } from "lucide-react";

export default function HeaderClientControls({ email }: { email: string }) {
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  const initials = email.split("@")[0].slice(0, 2).toUpperCase();

  return (
    <div className="flex items-center gap-2">
      <div title={email} className="w-7 h-7 rounded-full bg-amber-100 text-amber-800 text-[11px] font-semibold flex items-center justify-center">
        {initials}
      </div>
      <button
        onClick={handleSignOut}
        disabled={signingOut}
        title="Sign out"
        className="p-1.5 rounded-md text-fg-muted hover:text-fg-text hover:bg-fg-surface disabled:opacity-50"
      >
        <LogOut className="w-4 h-4" />
      </button>
    </div>
  );
}
