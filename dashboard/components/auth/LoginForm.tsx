"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/auth/supabase-browser";
import { LogIn, Loader2, AlertCircle, Mail, UserPlus, Clock } from "lucide-react";

type View = "login" | "reset" | "signup";

export default function LoginForm({ initialError }: { initialError?: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [fullName, setFullName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const diag = params.get("diag");
  const initialMsg =
    initialError === "pending_approval"
      ? "Your account is awaiting admin approval. We'll let you in once a founder reviews it."
      : initialError === "no_access"
      ? `Your account is inactive or hasn't been set up yet. Contact an admin.${diag ? ` (diag: ${diag})` : ""}`
      : null;
  const [error, setError] = useState<string | null>(initialMsg);
  const [pending, setPending] = useState(initialError === "pending_approval");

  const [view, setView] = useState<View>("login");
  const [resetSent, setResetSent] = useState(false);
  const [signupDone, setSignupDone] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true); setError(null); setPending(false);
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

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setError("Passwords don't match"); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters"); return; }
    setSubmitting(true); setError(null);
    try {
      const r = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
          full_name: fullName.trim(),
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Sign-up failed");
      setSignupDone(true);
    } catch (e: any) {
      setError(e?.message || "Sign-up failed");
    } finally { setSubmitting(false); }
  }

  // ===== RESET VIEW =====
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

  // ===== SIGN-UP VIEW =====
  if (view === "signup") {
    if (signupDone) {
      return (
        <div className="surface-card p-6 text-center">
          <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-forge-yellow-soft flex items-center justify-center">
            <Clock className="w-5 h-5 text-forge-orange-deep" />
          </div>
          <h2 className="font-semibold text-forge-black mb-1">Account created</h2>
          <p className="text-sm text-fg-muted">
            Your account is awaiting admin approval. A founder will review it and assign you a role.
            We&apos;ll let you in as soon as that&apos;s done.
          </p>
          <button onClick={() => { setView("login"); setSignupDone(false); setPassword(""); setConfirm(""); }} className="mt-4 text-xs text-forge-orange-deep hover:text-forge-orange font-medium">← Back to sign in</button>
        </div>
      );
    }
    return (
      <form onSubmit={handleSignup} className="surface-card p-6 space-y-4">
        <div>
          <h2 className="font-semibold text-forge-black mb-1">Create your account</h2>
          <p className="text-xs text-fg-muted">An admin will review and assign you a role before you can sign in.</p>
        </div>
        <Field label="Full name">
          <input type="text" required value={fullName} onChange={e => setFullName(e.target.value)} autoComplete="name" className="w-full text-sm px-3 py-2.5 border border-fg-border rounded-md bg-white focus:outline-none focus:border-forge-yellow focus:ring-2 focus:ring-forge-yellow/20" placeholder="Jane Doe" />
        </Field>
        <Field label="Email">
          <input type="email" required value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" className="w-full text-sm px-3 py-2.5 border border-fg-border rounded-md bg-white focus:outline-none focus:border-forge-yellow focus:ring-2 focus:ring-forge-yellow/20" placeholder="you@leveluplearning.in" />
        </Field>
        <Field label="Password">
          <input type="password" required minLength={8} value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" className="w-full text-sm px-3 py-2.5 border border-fg-border rounded-md bg-white focus:outline-none focus:border-forge-yellow focus:ring-2 focus:ring-forge-yellow/20" placeholder="at least 8 characters" />
        </Field>
        <Field label="Confirm password">
          <input type="password" required value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" className="w-full text-sm px-3 py-2.5 border border-fg-border rounded-md bg-white focus:outline-none focus:border-forge-yellow focus:ring-2 focus:ring-forge-yellow/20" />
        </Field>
        {error && <ErrorBox message={error} />}
        <button type="submit" disabled={submitting || !email || !password || !confirm || !fullName} className="btn-forge w-full">
          {submitting ? <Loader2 className="w-4 h-4 animate-spin"/> : <UserPlus className="w-4 h-4"/>}
          Create account
        </button>
        <button type="button" onClick={() => { setView("login"); setError(null); }} className="w-full text-xs text-fg-muted hover:text-forge-black">← Already have an account? Sign in</button>
      </form>
    );
  }

  // ===== LOGIN VIEW =====
  return (
    <form onSubmit={handleLogin} className="surface-card p-6 space-y-4">
      {pending && (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-md bg-forge-yellow-soft border border-forge-yellow text-forge-orange-deep text-xs">
          <Clock className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>Your account is awaiting admin approval. We&apos;ll let you in once a founder reviews it.</span>
        </div>
      )}
      <Field label="Email">
        <input type="email" required value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" className="w-full text-sm px-3 py-2.5 border border-fg-border rounded-md bg-white focus:outline-none focus:border-forge-yellow focus:ring-2 focus:ring-forge-yellow/20" placeholder="you@leveluplearning.in" />
      </Field>
      <Field label="Password">
        <input type="password" required value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" className="w-full text-sm px-3 py-2.5 border border-fg-border rounded-md bg-white focus:outline-none focus:border-forge-yellow focus:ring-2 focus:ring-forge-yellow/20" placeholder="••••••••" />
      </Field>
      {error && !pending && <ErrorBox message={error} />}
      <button type="submit" disabled={submitting || !email || !password} className="btn-forge w-full">
        {submitting ? <Loader2 className="w-4 h-4 animate-spin"/> : <LogIn className="w-4 h-4"/>}
        Sign in
      </button>
      <div className="flex items-center justify-between gap-3 pt-2 border-t border-fg-border/60">
        <button type="button" onClick={() => { setView("signup"); setError(null); setPending(false); }} className="text-xs text-forge-orange-deep hover:text-forge-orange font-semibold inline-flex items-center gap-1">
          <UserPlus className="w-3 h-3" />Create account
        </button>
        <button type="button" onClick={() => { setView("reset"); setError(null); setPending(false); }} className="text-xs text-fg-muted hover:text-forge-black">Forgot password?</button>
      </div>
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
