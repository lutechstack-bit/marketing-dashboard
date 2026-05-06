// TeleCRM API client — read-only sync layer.
//
// The dashboard reads its own Supabase tables, but TeleCRM is the operational
// hub: every lead from every Tally form, every Razorpay payment page, every
// call log, every status change is recorded there by the sales team. By
// syncing FROM TeleCRM we get a single source of truth without having to
// maintain Tally form_id mappings or Razorpay payment_link_id mappings —
// TeleCRM has already done that attribution work.
//
// Auth: Bearer token. Two scopes — sync (read) and async (write). We only
// need sync. Tokens live in env: TELECRM_SYNC_TOKEN, TELECRM_ENTERPRISE_ID.
//
// Docs: https://docs.telecrm.in/authentication

const SYNC_BASE = "https://next.telecrm.in/autoupdate/v2";

function envOrThrow(k: string): string {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env var: ${k}`);
  return v;
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${envOrThrow("TELECRM_SYNC_TOKEN")}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

function eid(): string {
  return envOrThrow("TELECRM_ENTERPRISE_ID");
}

// ---------------------------------------------------------------- types
export type TelecrmLead = {
  _id: string;
  fields: Record<string, any>;     // standard + custom fields
  status?: string;
  assignedTo?: string;
  created_on?: string;
  updated_on?: string;
};

export type TelecrmAction = {
  _id: string;
  type: string;                    // OUTGOING_CALL, STAGE_CHANGE, NOTE, etc.
  performed_by?: string;
  performed_at?: string;
  lead_id: string;
  details?: Record<string, any>;
};

export type TelecrmTeamMember = {
  _id: string;
  name: string;
  email: string;
  role?: string;
  active?: boolean;
};

export type TelecrmStage = {
  _id: string;
  name: string;
  order?: number;
  isWon?: boolean;
  isLost?: boolean;
};

// ---------------------------------------------------------------- internals
async function post<T>(path: string, body: any, query: Record<string, any> = {}): Promise<T> {
  const qs = Object.entries(query)
    .filter(([_, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");
  const url = `${SYNC_BASE}/enterprise/${eid()}${path}${qs ? `?${qs}` : ""}`;
  const res = await fetch(url, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TeleCRM ${path} ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

async function get<T>(path: string, query: Record<string, any> = {}): Promise<T> {
  const qs = Object.entries(query)
    .filter(([_, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");
  const url = `${SYNC_BASE}/enterprise/${eid()}${path}${qs ? `?${qs}` : ""}`;
  const res = await fetch(url, { method: "GET", headers: authHeaders() });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TeleCRM ${path} ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

// ---------------------------------------------------------------- public
/**
 * Search leads with optional field filters and date ranges. Paginates
 * automatically, batching up to `pageSize` per request.
 */
export async function* searchLeads(opts: {
  fields?: Record<string, any>;
  actions?: Record<string, any>;
  pageSize?: number;          // 1-100, default 100
  maxPages?: number;          // safety cap
} = {}): AsyncIterable<TelecrmLead> {
  const limit = Math.min(opts.pageSize ?? 100, 100);
  const maxPages = opts.maxPages ?? 1000;
  let skip = 0;
  for (let page = 0; page < maxPages; page++) {
    const body = {
      fields:  opts.fields  ?? {},
      actions: opts.actions ?? {},
    };
    const data = await post<{ leads?: TelecrmLead[]; total?: number; data?: TelecrmLead[] }>(
      "/lead/search",
      body,
      { skip, limit },
    );
    const items = data.leads || data.data || [];
    if (items.length === 0) return;
    for (const it of items) yield it;
    if (items.length < limit) return;
    skip += items.length;
  }
}

/** Search actions (call logs, stage changes, notes). */
export async function* searchActions(opts: {
  type?: string[];
  performed_by?: string;
  performed_at?: { from?: string; to?: string };
  pageSize?: number;
  maxPages?: number;
} = {}): AsyncIterable<TelecrmAction> {
  const limit = Math.min(opts.pageSize ?? 100, 100);
  const maxPages = opts.maxPages ?? 1000;
  let skip = 0;
  for (let page = 0; page < maxPages; page++) {
    const data = await post<{ actions?: TelecrmAction[]; data?: TelecrmAction[] }>(
      "/action/search",
      {
        type: opts.type,
        performed_by: opts.performed_by,
        performed_at: opts.performed_at,
      },
      { skip, limit },
    );
    const items = data.actions || data.data || [];
    if (items.length === 0) return;
    for (const it of items) yield it;
    if (items.length < limit) return;
    skip += items.length;
  }
}

/** List team members (sales reps + admins). */
export async function listTeamMembers(): Promise<TelecrmTeamMember[]> {
  const r = await get<{ members?: TelecrmTeamMember[]; data?: TelecrmTeamMember[] }>(
    "/team-members/list",
  );
  return r.members || r.data || [];
}

/** Get the lead-stage pipeline (Won / Lost / custom stages). */
export async function getStagePipeline(): Promise<TelecrmStage[]> {
  const r = await get<{ stages?: TelecrmStage[]; data?: TelecrmStage[] }>(
    "/enterprise/lead-stage-pipeline",
  );
  return r.stages || r.data || [];
}

/** List custom fields configured on the enterprise. */
export async function listCustomFields(): Promise<{ id: string; name: string; type: string }[]> {
  const r = await get<{ fields?: any[]; data?: any[] }>(
    "/enterprise/custom-fields-list",
  );
  const items = r.fields || r.data || [];
  return items.map((f: any) => ({ id: f._id || f.id, name: f.name, type: f.type }));
}

/** List custom action types (status changes, note types, etc.). */
export async function listCustomActions(): Promise<{ id: string; name: string; type: string }[]> {
  const r = await get<{ actions?: any[]; data?: any[] }>(
    "/enterprise/custom-actions-list",
  );
  const items = r.actions || r.data || [];
  return items.map((a: any) => ({ id: a._id || a.id, name: a.name, type: a.type }));
}

/** Get enterprise metadata — useful for confirming auth + discovering shape. */
export async function getMetadata(): Promise<any> {
  return get<any>("/enterprise/metadata");
}
