"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/auth/supabase-browser";
import { Loader2, Lock, CheckCircle2, AlertCircle } from "lucide-react";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setError("Passwords don't match"); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters"); return; }
    setSubmitting(true); setError(null);
    try {
      const sb = createSupabaseBrowserClient();
      const { error: err } = await sb.auth.updateUser({ password });
      if (err) throw err;
      setDone(true);
      setTimeout(() => { router.replace("/"); router.refresh(); }, 1500);
    } catch (e: any) {
      setError(e?.message || "Failed to update password");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-amber-50/40 via-white to-cyan-50/30 p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-amber-700 items-center justify-center font-bold text-white shadow-md mb-3">L</div>
          <h1 className="text-2xl font-bold tracking-tight text-fg-text">Set your password</h1>
        </div>
        {done ? (
          <div className="surface-card p-6 text-center">
            <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
            <h2 className="font-semibold text-fg-text">Password set!</h2>
            <p className="text-sm text-fg-muted mt-1">Redirecting…</p>
          </div>
        ) : (
          <form onSubmit={handleReset} className="surface-card p-6 space-y-4">
            <div>
              <label className="block text-xs text-fg-muted uppercase tracking-wider mb-1.5 font-medium">New password</label>
              <input type="password" required minLength={8} value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" className="w-full text-sm px-3 py-2 border border-fg-border rounded-md bg-white focus:outline-none focus:border-amber-400" placeholder="at least 8 characters" />
            </div>
            <div>
              <label className="block text-xs text-fg-muted uppercase tracking-wider mb-1.5 font-medium">Confirm</label>
              <input type="password" required value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" className="w-full text-sm px-3 py-2 border border-fg-border rounded-md bg-white focus:outline-none focus:border-amber-400" />
            </div>
            {error && (
              <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
            <button type="submit" disabled={submitting} className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-md bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50">
              {submitting ? <Loader2 className="w-4 h-4 animate-spin"/> : <Lock className="w-4 h-4"/>}
              Set password
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
