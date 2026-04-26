// AI-powered "why call this lead now" generator.
// GPT-4o-mini reads the lead's full application form responses + score breakdown
// and writes a 1–2 sentence rep-facing brief. Cached per lead+responses-hash
// for 7 days so we only pay the API cost once per change.
//
// Cost estimate: ~₹0.02 per first call per lead. With caching, ~₹100–200/month
// at current lead volume. Well under the founder's ₹500/month ceiling.

import crypto from "crypto";
import { unstable_cache } from "next/cache";
import type { LeadRow, FormSubmissionRow } from "./supabase";
import { PRODUCT_BY_CODE } from "./products";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4o-mini";

export type AiWhyHot = {
  why_now: string;        // 1 sentence — the urgency
  best_opener: string;    // 1 sentence — the conversation starter
  flag?: string | null;   // optional warning/strength callout
  generated_at: string;
  cache_key: string;
};

function inputHash(lead: LeadRow, responses: Record<string, any>): string {
  const payload = JSON.stringify({
    s: lead.score,
    f: lead.funnel_stage,
    p: lead.program,
    r: responses,
  });
  return crypto.createHash("sha1").update(payload).digest("hex").slice(0, 12);
}

function buildPrompt(lead: LeadRow, responses: Record<string, any>): string {
  const product = lead.program ? PRODUCT_BY_CODE[lead.program] : null;
  const productLine = product
    ? `${product.longName} (₹${product.appFeeInr.toLocaleString("en-IN")} application fee, ${product.family} program)`
    : (lead.program || "unknown program");

  const STAGE_DESC: Record<string, string> = {
    form_submitted: "completed the application form but has not yet paid the application fee",
    accepted:       "paid the application fee but has not yet booked an interview on Calendly",
    app_fee_paid:   "paid the application fee, next step is interview booking",
    confirmed:      "paid the ₹15,000 slot confirmation",
    balance_paid:   "paid in full",
    form_partial:   "started the form but did not complete it",
  };

  // Trim each response value so the prompt stays tight
  const trimmed: Record<string, string> = {};
  for (const [k, v] of Object.entries(responses).slice(0, 30)) {
    let s = "";
    if (Array.isArray(v))      s = v.join(", ");
    else if (v == null)        s = "";
    else if (typeof v === "object") s = JSON.stringify(v).slice(0, 240);
    else                       s = String(v);
    if (s.length > 240) s = s.slice(0, 240) + "…";
    if (s) trimmed[k] = s;
  }

  return `You are a sales coach for an Indian creative-careers bootcamp (LevelUp Learning). A sales rep is about to call a lead. In two short sentences, give them (1) the single most compelling reason to call NOW and (2) the single best opening line to use.

LEAD CONTEXT
- Program: ${productLine}
- Funnel stage: ${lead.funnel_stage} — ${STAGE_DESC[lead.funnel_stage || ""] || "unknown"}
- MQL Score: ${lead.score}/100
- Score breakdown: ${JSON.stringify(lead.score_breakdown || {})}
- Source campaign: ${lead.source_campaign_name || "—"}
- UTM source: ${lead.source_utm_source || "—"}

APPLICATION FORM ANSWERS (raw)
${Object.entries(trimmed).map(([k, v]) => `- ${k}: ${v}`).join("\n")}

OUTPUT JSON ONLY, no preamble:
{
  "why_now": "<one sentence — what makes this lead worth calling RIGHT NOW. Be specific to their answers, not generic.>",
  "best_opener": "<one sentence — the exact opening line the rep should use, in plain language. Reference one specific detail from their answers if possible.>",
  "flag": "<optional: one short warning OR strength callout if you spot something — e.g. 'wrote 800-char answer about wanting to leave their corporate job' or 'flagged budget concern in answer'. null if nothing notable.>"
}`;
}

async function callOpenAI(prompt: string): Promise<{ why_now: string; best_opener: string; flag: string | null } | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    console.error("[ai-insights] OPENAI_API_KEY not set");
    return null;
  }
  try {
    const r = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 220,
        temperature: 0.4,
        response_format: { type: "json_object" },
      }),
    });
    if (!r.ok) {
      const text = await r.text();
      console.error(`[ai-insights] OpenAI ${r.status}:`, text.slice(0, 200));
      return null;
    }
    const json = await r.json();
    const content = json?.choices?.[0]?.message?.content;
    if (!content) return null;
    const parsed = JSON.parse(content);
    return {
      why_now:     String(parsed.why_now || "").slice(0, 280),
      best_opener: String(parsed.best_opener || "").slice(0, 280),
      flag:        parsed.flag ? String(parsed.flag).slice(0, 200) : null,
    };
  } catch (e: any) {
    console.error("[ai-insights] error:", e?.message);
    return null;
  }
}

/**
 * Cached AI brief for one lead. Cache TTL 7 days, keyed by lead + responses hash
 * so any change to the form responses triggers a regeneration.
 */
export async function aiWhyHotCached(lead: LeadRow, submissions: FormSubmissionRow[]): Promise<AiWhyHot | null> {
  const responses: Record<string, any> = {};
  for (const s of submissions) {
    if (s.responses) Object.assign(responses, s.responses);
  }
  if (Object.keys(responses).length === 0) return null;

  const hash = inputHash(lead, responses);
  const cacheKey = `ai-why-hot-${lead.id}-${hash}`;

  const cached = unstable_cache(
    async () => {
      const prompt = buildPrompt(lead, responses);
      const result = await callOpenAI(prompt);
      if (!result) return null;
      return {
        ...result,
        generated_at: new Date().toISOString(),
        cache_key: cacheKey,
      } as AiWhyHot;
    },
    [cacheKey],
    { revalidate: 60 * 60 * 24 * 7, tags: [`lead-${lead.id}`] },
  );

  return await cached();
}
