"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/auth/supabase-browser";
import { LogIn, Loader2, AlertCircle, Mail } from "lucide-react";

export default function LoginForm({ initialError }: { initialError?: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(
    initialError === "no_access"
      ? "Your account is inactive or hasn't been set up yet. Contact an admin."
      : null
  );
  const [view, setView] = useState<"login" | "reset">("login");
  const [resetSent, setResetSent] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true); setError(null);
    try {
      if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
        throw new Error("Auth setup incomplete — admin needs to finish configuring Supabase Auth.");
      }
      const sb = createSupabaseBrowserClient();
      const { error: err } = await sb.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (err) throw err;
      const next = params.get("next") || "/";
      router.replace(next);
      router.refresh();
    } catch (e: any) {
      setError(e?.message || "Sign-in failed");
    } finally { setSubmitting(false); }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true); setError(null);
    try {
      const sb = createSupabaseBrowserClient();
      const { error: err } = await sb.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
        redirectTo: `${window.location.origin}/auth/reset-password`,
      });
      if (err) throw err;
      setResetSent(true);
    } catch (e: any) {
      setError(e?.message || "Failed to send reset email");
    } finally { setSubmitting(false); }
  }

  if (view === "reset") {
    return (
      <div className="surface-card p-6">
        {resetSent ? (
          <div className="text-center">
            <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-forge-yellow-soft flex items-center justify-center">
              <Mail className="w-5 h-5 text-forge-orange-deep" />
            </div>
            <h2 className="font-semibold text-forge-black mb-1">Check your inbox</h2>
            <p className="text-sm text-fg-muted">We sent a reset link to <span className="font-medium text-forge-black">{email}</span>.</p>
            <button onClick={() => { setView("login"); setResetSent(false); }} className="mt-4 text-xs text-forge-orange-deep hover:text-forge-orange font-medium">← Back to sign in</button>
          </div>
        ) : (
          <form onSubmit={handleReset} className="space-y-4">
            <div>
              <h2 className="font-semibold text-forge-black mb-1">Reset your password</h2>
              <p className="text-xs text-fg-muted">Enter your email and we&apos;ll send you a reset link.</p>
            </div>
            <Field label="Email">
              <input type="email" required value={email} onChange={e => setEmail(e.target.value)} className="w-full text-sm px-3 py-2.5 border border-fg-border rounded-md bg-white focus:outline-none focus:border-forge-yellow focus:ring-2 focus:ring-forge-yellow/20" placeholder="you@leveluplearning.in" />
            </Field>
            {error && <ErrorBox message={error} />}
            <button type="submit" disabled={submitting || !email} className="btn-forge w-full">
              {submitting ? <Loader2 className="w-4 h-4 animate-spin"/> : <Mail className="w-4 h-4"/>}
              Send reset link
            </button>
            <button type="button" onClick={() => setView("login")} className="w-full text-xs text-fg-muted hover:text-forge-black">← Back to sign in</button>
          </form>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={handleLogin} className="surface-card p-6 space-y-4">
      <Field label="Email">
        <input type="email" required value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" className="w-full text-sm px-3 py-2.5 border border-fg-border rounded-md bg-white focus:outline-none focus:border-forge-yellow focus:ring-2 focus:ring-forge-yellow/20" placeholder="you@leveluplearning.in" />
      </Field>
      <Field label="Password">
        <input type="password" required value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" className="w-full text-sm px-3 py-2.5 border border-fg-border rounded-md bg-white focus:outline-none focus:border-forge-yellow focus:ring-2 focus:ring-forge-yellow/20" placeholder="••••••••" />
      </Field>
      {error && <ErrorBox message={error} />}
      <button type="submit" disabled={submitting || !email || !password} className="btn-forge w-full">
        {submitting ? <Loader2 className="w-4 h-4 animate-spin"/> : <LogIn className="w-4 h-4"/>}
        Sign in
      </button>
      <button type="button" onClick={() => setView("reset")} className="w-full text-xs text-fg-muted hover:text-forge-black">Forgot password?</button>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] text-fg-muted uppercase tracking-[0.12em] mb-1.5 font-semibold">{label}</label>
      {children}
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs">
      <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
      <span>{message}</span>
    </div>
  );
}
