"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/auth/supabase-browser";
import { Loader2, Lock, CheckCircle2, AlertCircle, Mail } from "lucide-react";
import ForgeWordmark, { ForgeWave } from "@/components/ForgeWordmark";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // Detect expired-link state from URL hash params (Supabase recovery flow)
  const [linkExpired, setLinkExpired] = useState<{ description: string } | null>(null);
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Hash params from Supabase: either error info OR access_token (implicit
    // recovery flow). Query string would carry ?code=... for PKCE flow.
    const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
    const hashParams = new URLSearchParams(hash);
    const err = hashParams.get("error");
    if (err) {
      const desc = (hashParams.get("error_description") || "Link is invalid or has expired.").replace(/\+/g, " ");
      setLinkExpired({ description: desc });
      return;
    }

    const sb = createSupabaseBrowserClient();
    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      if (session) setSessionReady(true);
    });

    (async () => {
      // Already signed in (e.g. user came back to this tab) — let them set a new password
      const { data: existing } = await sb.auth.getSession();
      if (existing.session) { setSessionReady(true); return; }

      // Implicit flow: tokens land in the URL hash. Set them explicitly because
      // @supabase/ssr's browser client doesn't always auto-detect implicit hashes.
      const access_token = hashParams.get("access_token");
      const refresh_token = hashParams.get("refresh_token");
      if (access_token && refresh_token) {
        const { error: setErr } = await sb.auth.setSession({ access_token, refresh_token });
        if (setErr) setLinkExpired({ description: setErr.message || "Recovery link is invalid or expired." });
        else {
          setSessionReady(true);
          // Strip the tokens out of the URL so a refresh doesn't re-process them.
          history.replaceState(null, "", window.location.pathname);
        }
        return;
      }

      // PKCE flow: ?code=... in query string — exchange for session
      const code = new URLSearchParams(window.location.search).get("code");
      if (code) {
        const { error: exErr } = await sb.auth.exchangeCodeForSession(code);
        if (exErr) setLinkExpired({ description: exErr.message || "Recovery link is invalid or expired." });
        else { setSessionReady(true); history.replaceState(null, "", window.location.pathname); }
        return;
      }

      // No tokens at all — the user landed here without a recovery link
      setLinkExpired({ description: "No recovery token found. Use a fresh password reset link." });
    })();

    return () => { sub.subscription.unsubscribe(); };
  }, []);

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
    <main className="min-h-screen flex items-center justify-center bg-forge-cream relative overflow-hidden p-6">
      <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-forge-yellow opacity-20 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 -right-32 w-96 h-96 rounded-full bg-forge-orange opacity-15 blur-3xl pointer-events-none" />

      <div className="w-full max-w-sm relative">
        <div className="text-center mb-8">
          <div className="inline-flex w-14 h-14 rounded-2xl bg-forge-gradient items-center justify-center shadow-soft mb-4">
            <span className="font-display font-extrabold italic text-forge-black text-2xl leading-none">F</span>
          </div>
          <div className="flex justify-center mb-2">
            <ForgeWordmark size="lg" />
          </div>
          <ForgeWave className="mx-auto w-16 h-3 mb-3" />
          <h1 className="font-display text-2xl font-extrabold italic text-forge-black">Set your password</h1>
        </div>

        {linkExpired ? (
          <div className="surface-card p-6 text-center">
            <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-rose-50 flex items-center justify-center">
              <AlertCircle className="w-5 h-5 text-rose-600" />
            </div>
            <h2 className="font-semibold text-forge-black mb-1">Link expired</h2>
            <p className="text-sm text-fg-muted">{linkExpired.description}</p>
            <p className="text-xs text-fg-muted mt-3">Magic links expire after about an hour. Ask an admin for a fresh one, or request a password reset from the sign-in page.</p>
            <Link href="/login" className="inline-flex items-center gap-1.5 mt-4 text-xs text-forge-orange-deep hover:text-forge-orange font-semibold">
              <Mail className="w-3.5 h-3.5" />Go to sign in
            </Link>
          </div>
        ) : done ? (
          <div className="surface-card p-6 text-center">
            <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
            <h2 className="font-semibold text-forge-black">Password set!</h2>
            <p className="text-sm text-fg-muted mt-1">Redirecting…</p>
          </div>
        ) : (
          <form onSubmit={handleReset} className="surface-card p-6 space-y-4">
            <Field label="New password">
              <input type="password" required minLength={8} value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" className="w-full text-sm px-3 py-2.5 border border-fg-border rounded-md bg-white focus:outline-none focus:border-forge-yellow focus:ring-2 focus:ring-forge-yellow/20" placeholder="at least 8 characters" />
            </Field>
            <Field label="Confirm">
              <input type="password" required value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" className="w-full text-sm px-3 py-2.5 border border-fg-border rounded-md bg-white focus:outline-none focus:border-forge-yellow focus:ring-2 focus:ring-forge-yellow/20" />
            </Field>
            {error && (
              <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
            {!sessionReady && (
              <div className="flex items-center gap-2 text-xs text-fg-muted">
                <Loader2 className="w-3 h-3 animate-spin" />Verifying recovery link…
              </div>
            )}
            <button type="submit" disabled={submitting || !sessionReady} className="btn-forge w-full">
              {submitting ? <Loader2 className="w-4 h-4 animate-spin"/> : <Lock className="w-4 h-4"/>}
              Set password
            </button>
          </form>
        )}
      </div>
    </main>
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
