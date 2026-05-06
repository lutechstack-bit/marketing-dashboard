"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Users, UserPlus, Power, KeyRound, Loader2, Copy, Check, X, Plus, Trash2, Clock, ShieldCheck, UserX } from "lucide-react";
import { inr } from "@/lib/format";

type Rep = { id: string; email: string; full_name: string | null; phone: string | null; role: "sales" | "founder" | "admin"; active: boolean; created_at: string };
type Assignment = { id: string; rep_id: string; product_code: string; edition_match: string | null; edition_label: string | null; incentive_inr: number; active: boolean };
type Product = { code: string; name: string; long_name: string; family: string };

const ROLE_BADGE: Record<Rep["role"], string> = {
  sales: "bg-cyan-50 text-cyan-700 ring-1 ring-cyan-200",
  founder: "bg-forge-yellow-pale text-forge-orange-deep ring-1 ring-forge-yellow-soft",
  admin: "bg-forge-yellow-soft text-forge-orange-deep ring-1 ring-forge-yellow",
};

export default function TeamClient({ reps, assignments, products, currentRepId }: { reps: Rep[]; assignments: Assignment[]; products: Product[]; currentRepId: string }) {
  const router = useRouter();
  const [showAdd, setShowAdd] = useState(false);
  const [showLink, setShowLink] = useState<{ name: string; link: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Group assignments per rep
  const assignmentsByRep: Record<string, Assignment[]> = {};
  for (const a of assignments) (assignmentsByRep[a.rep_id] ||= []).push(a);

  async function deactivate(id: string) {
    if (id === currentRepId) { alert("You can't deactivate yourself."); return; }
    if (!confirm("Deactivate this user? They won't be able to log in.")) return;
    setBusy(id);
    const r = await fetch("/api/admin/team", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "deactivate", id }) });
    if (r.ok) router.refresh();
    else alert((await r.json()).error || "Failed");
    setBusy(null);
  }

  async function reactivate(id: string) {
    setBusy(id);
    const r = await fetch("/api/admin/team", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reactivate", id }) });
    if (r.ok) router.refresh();
    else alert((await r.json()).error || "Failed");
    setBusy(null);
  }

  async function getPasswordLink(rep: Rep) {
    setBusy(rep.id);
    try {
      const r = await fetch("/api/admin/team", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send_password_link", id: rep.id, email: rep.email }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Failed");
      setShowLink({ name: rep.full_name || rep.email, link: j.set_password_link });
    } catch (e: any) { alert(e.message); }
    setBusy(null);
  }

  async function approveAs(repId: string, role: Rep["role"]) {
    setBusy(repId);
    try {
      const r = await fetch("/api/admin/team", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", id: repId, role }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Approval failed");
      router.refresh();
    } catch (e: any) { alert(e.message); }
    setBusy(null);
  }

  async function rejectPending(rep: Rep) {
    if (!confirm(`Reject ${rep.full_name || rep.email}? This deletes their account.`)) return;
    setBusy(rep.id);
    try {
      const r = await fetch("/api/admin/team", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject", id: rep.id }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Rejection failed");
      router.refresh();
    } catch (e: any) { alert(e.message); }
    setBusy(null);
  }

  // Pending = self-signed up, never approved (active=false AND no assignments).
  // Anyone deactivated by an admin keeps any old assignments, so they fall into
  // the main table with "Disabled" status instead.
  const pendingReps = reps.filter(r => !r.active && (assignmentsByRep[r.id] || []).length === 0);
  const otherReps = reps.filter(r => !pendingReps.includes(r));

  return (
    <div>
      <div className="flex items-end justify-between gap-3 flex-wrap mb-5">
        <div>
          <h1 className="font-display text-4xl font-extrabold italic tracking-tight text-forge-black inline-flex items-center gap-3">
            <Users className="w-8 h-8 text-forge-orange-deep not-italic" />
            <span><span className="brand-underline">Team</span></span>
          </h1>
          <p className="text-sm text-fg-muted mt-2">
            {reps.length} {reps.length === 1 ? "person" : "people"} — manage roles, assignments, password links
            {pendingReps.length > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 text-forge-orange-deep font-semibold">
                <Clock className="w-3 h-3" />{pendingReps.length} awaiting approval
              </span>
            )}
          </p>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn-forge">
          <UserPlus className="w-4 h-4" />Invite new user
        </button>
      </div>

      {showAdd && <AddUserForm products={products} onClose={() => setShowAdd(false)} onCreated={(link) => { setShowAdd(false); router.refresh(); if (link) setShowLink({ name: "New user", link }); }} />}
      {showLink && <LinkModal title={showLink.name} link={showLink.link} onClose={() => setShowLink(null)} />}

      {/* Pending approval queue — self-signups awaiting admin review */}
      {pendingReps.length > 0 && (
        <div className="surface-card mb-6 overflow-hidden border-l-4 border-l-forge-yellow">
          <div className="bg-forge-radial px-5 py-4 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-forge-orange-deep" />
              <div>
                <h2 className="font-display text-xl font-extrabold italic text-forge-black">Pending approval</h2>
                <p className="text-xs text-fg-muted">{pendingReps.length} {pendingReps.length === 1 ? "person" : "people"} signed up — pick a role to grant access, or reject.</p>
              </div>
            </div>
          </div>
          <div className="divide-y divide-fg-border/70">
            {pendingReps.map(r => (
              <div key={r.id} className="px-5 py-3 flex items-center gap-4 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-forge-black truncate">{r.full_name || <span className="italic text-fg-subtle">unnamed</span>}</div>
                  <div className="text-xs text-fg-muted truncate">{r.email} · signed up {new Date(r.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })}</div>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] uppercase tracking-[0.12em] text-fg-muted font-semibold mr-1">Approve as</span>
                  <ApproveBtn label="Sales" onClick={() => approveAs(r.id, "sales")} busy={busy === r.id} />
                  <ApproveBtn label="Founder" onClick={() => approveAs(r.id, "founder")} busy={busy === r.id} />
                  <ApproveBtn label="Admin" onClick={() => approveAs(r.id, "admin")} busy={busy === r.id} />
                  <button
                    onClick={() => rejectPending(r)}
                    disabled={busy === r.id}
                    title="Reject and delete account"
                    className="ml-2 p-1.5 rounded text-fg-muted hover:text-rose-700 hover:bg-rose-50 disabled:opacity-40"
                  >
                    <UserX className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <p className="px-5 py-2 text-[10px] text-fg-subtle bg-forge-cream/60 border-t border-fg-border/60">
            After approval you can add product/incentive assignments inline on the row below.
          </p>
        </div>
      )}

      <div className="surface-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-fg-surface border-b border-fg-border">
            <tr className="text-left text-[11px] uppercase tracking-wider text-fg-muted">
              <th className="py-3 pl-4 pr-2 font-medium">Name</th>
              <th className="py-3 px-2 font-medium">Email</th>
              <th className="py-3 px-2 font-medium">Role</th>
              <th className="py-3 px-2 font-medium">Programs</th>
              <th className="py-3 px-2 font-medium">Status</th>
              <th className="py-3 pr-4 pl-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {otherReps.map(r => {
              const a = assignmentsByRep[r.id] || [];
              return (
                <tr key={r.id} className={`border-b border-fg-border/70 row-hover ${!r.active ? "opacity-60" : ""}`}>
                  <td className="py-3 pl-4 pr-2 font-semibold text-forge-black">
                    {r.full_name || <span className="italic text-fg-subtle">unnamed</span>}
                    {r.id === currentRepId && <span className="ml-2 text-[10px] font-bold text-forge-orange-deep px-1.5 py-0.5 bg-forge-yellow-soft rounded">YOU</span>}
                  </td>
                  <td className="py-3 px-2 text-fg-muted">{r.email}</td>
                  <td className="py-3 px-2">
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${ROLE_BADGE[r.role]}`}>{r.role}</span>
                  </td>
                  <td className="py-3 px-2 max-w-[280px]">
                    {a.length > 0 ? (
                      <div className="text-xs text-forge-black/85 leading-tight space-x-2">
                        {a.map(x => (
                          <span key={x.id} className="inline-block whitespace-nowrap">
                            {x.product_code}{x.edition_label ? `·${x.edition_label}` : ""} <span className="text-forge-orange-deep font-semibold">{inr(x.incentive_inr)}</span>
                          </span>
                        ))}
                      </div>
                    ) : <span className="text-fg-subtle text-xs italic">—</span>}
                  </td>
                  <td className="py-3 px-2">
                    {r.active
                      ? <span className="text-[11px] text-emerald-700 font-semibold">● Active</span>
                      : <span className="text-[11px] text-rose-700 font-semibold">● Disabled</span>}
                  </td>
                  <td className="py-3 pr-4 pl-2">
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => getPasswordLink(r)}
                        disabled={busy === r.id}
                        title="Generate set-password link"
                        className="p-1.5 rounded text-fg-muted hover:text-forge-orange-deep hover:bg-forge-yellow-pale"
                      >
                        {busy === r.id ? <Loader2 className="w-4 h-4 animate-spin"/> : <KeyRound className="w-4 h-4"/>}
                      </button>
                      {r.active ? (
                        <button
                          onClick={() => deactivate(r.id)}
                          disabled={busy === r.id || r.id === currentRepId}
                          title="Deactivate"
                          className="p-1.5 rounded text-fg-muted hover:text-rose-700 hover:bg-rose-50 disabled:opacity-30"
                        >
                          <Power className="w-4 h-4" />
                        </button>
                      ) : (
                        <button
                          onClick={() => reactivate(r.id)}
                          disabled={busy === r.id}
                          title="Reactivate"
                          className="p-1.5 rounded text-fg-muted hover:text-emerald-700 hover:bg-emerald-50"
                        >
                          <Power className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-fg-subtle mt-4">
        Tip: Use the key icon to generate a one-time set-password link for any user — useful when someone forgets their password or needs re-onboarding.
      </p>
    </div>
  );
}

function AddUserForm({ products, onClose, onCreated }: { products: Product[]; onClose: () => void; onCreated: (link: string | null) => void }) {
  const [full_name, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<Rep["role"]>("sales");
  const [assignments, setAssignments] = useState<{ product_code: string; edition_match: string; edition_label: string; incentive_inr: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addAssignment = () => setAssignments([...assignments, { product_code: products[0]?.code || "", edition_match: "", edition_label: "", incentive_inr: "" }]);
  const removeAssignment = (i: number) => setAssignments(assignments.filter((_, j) => j !== i));
  const updateAssignment = (i: number, key: string, val: string) => {
    const next = [...assignments]; (next[i] as any)[key] = val; setAssignments(next);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true); setError(null);
    try {
      const cleanedAssignments = assignments
        .filter(a => a.product_code && a.incentive_inr)
        .map(a => ({
          product_code: a.product_code,
          edition_match: a.edition_match || null,
          edition_label: a.edition_label || null,
          incentive_inr: parseFloat(a.incentive_inr),
        }));
      const r = await fetch("/api/admin/team", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "invite", email, full_name, phone, role, assignments: cleanedAssignments }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Failed");
      onCreated(j.set_password_link || j.invite_link || null);
    } catch (e: any) {
      setError(e.message);
    } finally { setSubmitting(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-6">
      <form onSubmit={submit} className="surface-card max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-2xl font-extrabold italic text-forge-black inline-flex items-center gap-2"><UserPlus className="w-5 h-5 text-forge-orange-deep not-italic" />Invite new user</h2>
          <button type="button" onClick={onClose} className="text-fg-muted hover:text-fg-text"><X className="w-5 h-5" /></button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
          <Field label="Full name *">
            <input required value={full_name} onChange={e => setFullName(e.target.value)} className="w-full text-sm px-3 py-2 border border-fg-border rounded-md" placeholder="e.g. Pranav Kumar" />
          </Field>
          <Field label="Email *">
            <input required type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full text-sm px-3 py-2 border border-fg-border rounded-md" placeholder="user@example.com" />
          </Field>
          <Field label="Phone (optional)">
            <input value={phone} onChange={e => setPhone(e.target.value)} className="w-full text-sm px-3 py-2 border border-fg-border rounded-md" placeholder="+91 9xxx xxx xxx" />
          </Field>
          <Field label="Role *">
            <select value={role} onChange={e => setRole(e.target.value as Rep["role"])} className="w-full text-sm px-3 py-2 border border-fg-border rounded-md bg-fg-card">
              <option value="sales">Sales rep</option>
              <option value="founder">Founder</option>
              <option value="admin">Admin (founder + payouts)</option>
            </select>
          </Field>
        </div>

        {role === "sales" && (
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs uppercase tracking-wider text-fg-muted font-semibold">Program assignments + incentives</div>
              <button type="button" onClick={addAssignment} className="text-xs text-forge-orange-deep hover:text-forge-orange inline-flex items-center gap-1 font-semibold"><Plus className="w-3 h-3" />Add</button>
            </div>
            <div className="space-y-2">
              {assignments.length === 0 && <div className="text-xs text-fg-subtle italic">No programs assigned yet — add at least one if this rep should earn incentives.</div>}
              {assignments.map((a, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center">
                  <select value={a.product_code} onChange={e => updateAssignment(i, "product_code", e.target.value)} className="col-span-3 text-sm px-2 py-1.5 border border-fg-border rounded-md bg-fg-card">
                    {products.map(p => <option key={p.code} value={p.code}>{p.code} · {p.name}</option>)}
                  </select>
                  <input value={a.edition_match} onChange={e => updateAssignment(i, "edition_match", e.target.value)} placeholder="edition regex (optional)" className="col-span-3 text-sm px-2 py-1.5 border border-fg-border rounded-md" />
                  <input value={a.edition_label} onChange={e => updateAssignment(i, "edition_label", e.target.value)} placeholder="label (optional)" className="col-span-2 text-sm px-2 py-1.5 border border-fg-border rounded-md" />
                  <input type="number" value={a.incentive_inr} onChange={e => updateAssignment(i, "incentive_inr", e.target.value)} placeholder="₹ amount" className="col-span-3 text-sm px-2 py-1.5 border border-fg-border rounded-md" />
                  <button type="button" onClick={() => removeAssignment(i)} className="col-span-1 text-fg-muted hover:text-rose-600"><Trash2 className="w-4 h-4 mx-auto" /></button>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-fg-subtle mt-2">Edition regex: leave blank for catch-all default. Use e.g. <code>bali</code> to match leads who picked a Bali edition.</p>
          </div>
        )}

        {error && <div className="mt-3 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">{error}</div>}

        <div className="flex justify-end gap-2 mt-5">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-md border border-fg-border text-fg-muted hover:bg-fg-surface">Cancel</button>
          <button type="submit" disabled={submitting} className="btn-forge disabled:opacity-50">
            {submitting ? <Loader2 className="w-4 h-4 animate-spin"/> : <UserPlus className="w-4 h-4"/>}
            Send invite
          </button>
        </div>
      </form>
    </div>
  );
}

function LinkModal({ title, link, onClose }: { title: string; link: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-6">
      <div className="surface-card max-w-2xl w-full p-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display text-2xl font-extrabold italic text-forge-black inline-flex items-center gap-2"><KeyRound className="w-5 h-5 text-forge-orange-deep not-italic" />Set-password link</h2>
          <button onClick={onClose} className="text-fg-muted hover:text-fg-text"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-sm text-fg-muted mb-3">Send this link to <span className="font-semibold text-forge-black">{title}</span>. They click it, set a new password, and they&apos;re in.</p>
        <div className="bg-forge-cream border border-forge-yellow-soft rounded-md p-3 text-xs break-all font-mono text-forge-black">{link}</div>
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={() => { navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
            className="btn-forge"
          >
            {copied ? <Check className="w-4 h-4"/> : <Copy className="w-4 h-4"/>}
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
        <p className="text-[10px] text-fg-subtle mt-3">Link is single-use and expires within ~1 hour.</p>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-fg-muted uppercase tracking-wider mb-1 font-medium">{label}</label>
      {children}
    </div>
  );
}

function ApproveBtn({ label, onClick, busy }: { label: string; onClick: () => void; busy: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md bg-forge-yellow text-forge-black hover:bg-forge-orange shadow-soft disabled:opacity-50"
    >
      {busy ? <Loader2 className="w-3 h-3 animate-spin"/> : <ShieldCheck className="w-3 h-3"/>}
      {label}
    </button>
  );
}
