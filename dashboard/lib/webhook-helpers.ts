// Shared helpers for webhook receivers — form/program mapping + amount → payment_type
// inference + lead upsert by email/phone.

import { supabase } from "./supabase";

// Tally form ID → program code. Add new forms here when wiring webhooks.
export const TALLY_FORM_TO_PROGRAM: Record<string, { program: string; name: string }> = {
  // ---- Forge ----
  "nPJydd": { program: "FFM", name: "Forge Filmmaking (current Meta)"   },
  "316Mel": { program: "FFM", name: "Forge Filmmaking (legacy main)"    },
  "3xLgrd": { program: "FFM", name: "Forge Filmmaking YT"               },
  "wQ4YQ8": { program: "FFM", name: "Filmmaking Bootcamp Forge YT"      },
  "3NZXk0": { program: "FW",  name: "Forge Writing (current)"           },
  "3lY56o": { program: "FW",  name: "Forge Writing (legacy)"            },
  "kdWEXR": { program: "FAI", name: "Forge AI"                          },
  "3EgP2L": { program: "FC",  name: "Forge Creators"                    },
  // ---- Live (ready when you wire webhooks for them) ----
  "nWLkyk": { program: "VE",  name: "VE | EXP (Meta Ads)"               },
  "dWPVQd": { program: "VE",  name: "VE | Google Ads"                   },
  "1AKWXp": { program: "VE",  name: "VE | EXP (YT Collab)"              },
  "npvj5y": { program: "BFP", name: "BFP | Exp (Meta Ads)"              },
  "81dRPA": { program: "FC",  name: "Creators <> Meta Ads"              },
};

// Razorpay payment amount (in INR) → { payment_type, program } inference.
// From the credentials doc — order matters: more-specific first.
export function inferPaymentType(amountInr: number): { payment_type: string; program: string | null } {
  // Application fees
  if (amountInr === 400) return { payment_type: "app_fee", program: null };       // Live (any)
  if (amountInr === 600) return { payment_type: "app_fee", program: "FW"  };
  if (amountInr === 700) return { payment_type: "app_fee", program: "FC"  };
  if (amountInr === 800) return { payment_type: "app_fee", program: "FFM" };
  if (amountInr === 900) return { payment_type: "app_fee", program: "FAI" };
  // Confirmation
  if (amountInr === 8000)  return { payment_type: "confirmation", program: null };  // Live
  if (amountInr === 15000) return { payment_type: "confirmation", program: null };  // Forge (any)
  if (amountInr === 17500) return { payment_type: "confirmation", program: "FW"  }; // Forge Writing variant
  // Masterclass
  if (amountInr === 1499 || amountInr === 2499) return { payment_type: "masterclass", program: null };
  // Full / balance
  if (amountInr >= 50000) return { payment_type: "full", program: null };
  // Unknown
  return { payment_type: "unknown", program: null };
}

/**
 * Find an existing lead by (email or phone) within an optional program scope.
 * Returns the lead row if found, null if not.
 */
export async function findLead(opts: { email?: string | null; phone?: string | null; program?: string | null }) {
  const { email, phone, program } = opts;
  if (!email && !phone) return null;

  // Build OR clause carefully — Supabase or() takes a CSV of conditions
  const orParts: string[] = [];
  if (email) orParts.push(`email.eq.${email.toLowerCase()}`);
  if (phone) orParts.push(`phone.eq.${normalizePhone(phone)}`);

  let q = supabase.from("leads").select("*").or(orParts.join(","));
  if (program) q = q.eq("program", program);

  const { data, error } = await q.limit(1).maybeSingle();
  if (error) {
    console.error("findLead error:", error.message);
    return null;
  }
  return data;
}

/**
 * Create or update a lead. Returns the lead row.
 * Identity: (email, program) OR (phone, program).
 */
export async function upsertLead(input: {
  email?: string | null;
  phone?: string | null;
  name?: string | null;
  program?: string | null;
  source_campaign_name?: string | null;
  source_utm_source?: string | null;
  source_utm_medium?: string | null;
  source_utm_campaign?: string | null;
  funnel_stage?: string | null;
}) {
  const email = input.email?.toLowerCase() || null;
  const phone = normalizePhone(input.phone);
  const program = input.program || null;

  // Try find existing
  const existing = await findLead({ email, phone, program });
  if (existing) {
    const updates: Record<string, any> = { last_activity: new Date().toISOString() };
    // Backfill missing fields only — never clobber better data with empty values
    if (!existing.name && input.name) updates.name = input.name;
    if (!existing.email && email)     updates.email = email;
    if (!existing.phone && phone)     updates.phone = phone;
    if (!existing.program && program) updates.program = program;
    if (input.funnel_stage) updates.funnel_stage = input.funnel_stage;
    if (input.source_campaign_name && !existing.source_campaign_name) updates.source_campaign_name = input.source_campaign_name;
    if (input.source_utm_source && !existing.source_utm_source) updates.source_utm_source = input.source_utm_source;
    if (input.source_utm_medium && !existing.source_utm_medium) updates.source_utm_medium = input.source_utm_medium;
    if (input.source_utm_campaign && !existing.source_utm_campaign) updates.source_utm_campaign = input.source_utm_campaign;

    const { data, error } = await supabase.from("leads").update(updates).eq("id", existing.id).select().single();
    if (error) { console.error("upsertLead update error:", error.message); return existing; }
    return data;
  }

  // Insert new
  const { data, error } = await supabase.from("leads").insert({
    email, phone, name: input.name || null, program,
    source_campaign_name: input.source_campaign_name || null,
    source_utm_source:    input.source_utm_source || null,
    source_utm_medium:    input.source_utm_medium || null,
    source_utm_campaign:  input.source_utm_campaign || null,
    funnel_stage:         input.funnel_stage || "form_partial",
    score: 0, score_breakdown: {},
    first_seen: new Date().toISOString(),
    last_activity: new Date().toISOString(),
  }).select().single();
  if (error) { console.error("upsertLead insert error:", error.message); return null; }
  return data;
}

export function normalizePhone(raw?: string | null): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (!digits) return null;
  // India: strip leading 0, ensure 91 prefix for 10-digit numbers
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  return digits;
}

/** Given form fields in Tally's flat structure, extract email / phone / name + a flat responses dict.
 *  Permissive: accepts string or number values, matches a wide range of label patterns,
 *  handles Tally's multi-choice option-ID → label resolution. */
export function tallyExtractFields(fields: any[]): {
  email: string | null; phone: string | null; name: string | null; responses: Record<string, any>;
} {
  const responses: Record<string, any> = {};
  let email: string | null = null;
  let phone: string | null = null;
  let name: string | null = null;

  const stringify = (v: any): string => {
    if (v == null) return "";
    if (typeof v === "string") return v.trim();
    if (typeof v === "number") return String(v);
    if (Array.isArray(v)) return v.map(stringify).filter(Boolean).join(", ");
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  };

  for (const f of fields || []) {
    const label = (f.label || f.key || "").toString().trim();
    const type = (f.type || "").toUpperCase();
    let val = f.value;
    if (Array.isArray(val) && f.options) {
      const labelMap = Object.fromEntries(f.options.map((o: any) => [o.id, o.text]));
      val = val.map((v: any) => labelMap[v] || v);
    }
    if (label) responses[label] = val;

    // EMAIL — broad detection
    if (!email) {
      if (type === "INPUT_EMAIL" || /e-?mail/i.test(label) || /e-?mail/i.test(f.key || "")) {
        const s = stringify(val);
        if (s.includes("@")) email = s.toLowerCase();
      }
    }
    // PHONE — broad detection (Tally types: INPUT_PHONE_NUMBER; also INPUT_TEXT/INPUT_NUMBER with phone label)
    if (!phone) {
      const phoneLabel = /phone|mobile|whatsapp|contact\s*num|cell|^number$/i.test(label) || /phone|mobile|whatsapp/i.test(f.key || "");
      const phoneType = type === "INPUT_PHONE_NUMBER";
      if (phoneType || phoneLabel) {
        const s = stringify(val).replace(/[^\d+]/g, "");
        if (s.length >= 8) phone = s;
      }
    }
    // NAME — broad detection
    if (!name) {
      const nameLabel = /^name$|full[\s_-]?name|your[\s_-]?name|first[\s_-]?name|legal[\s_-]?name/i.test(label);
      if (nameLabel) {
        const s = stringify(val);
        if (s && s.length < 200) name = s;
      }
    }
  }
  return { email, phone, name, responses };
}
