// Re-fetch phone numbers DIRECTLY from Tally API for leads where lead.phone IS NULL.
//
// Why: the OLD Python ingestion script stored phone values as truncated integers
// (e.g. "Your Whatsapp Number" = 98 or 862999 instead of full 10-digit numbers).
// Tally itself still has the canonical full numbers. This endpoint pulls them
// fresh, matches by email, and updates the lead.
//
// Usage:
//   GET /api/maintenance/refetch-phones-from-tally?form=3EgP2L&pages=20
//   GET /api/maintenance/refetch-phones-from-tally?form=ALL&pages=10
//
// Recommended: run per-form so you can see progress.

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { TALLY_FORM_TO_PROGRAM, normalizePhone } from "@/lib/webhook-helpers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TALLY_TOKEN = process.env.TALLY_API_KEY || "tly-DvgcmXK5t0OXwJ7sByzgaYAgob7V83Aa"; // fallback

async function tallyFetch(url: string): Promise<any> {
  const r = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${TALLY_TOKEN}`,
      "tally-version": "2025-02-01",
    },
  });
  if (!r.ok) throw new Error(`Tally ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

/** Extract phone + email from a Tally API submission's responses array. */
function extractFromTally(responses: any[], questions: any[]): { email: string | null; phone: string | null; name: string | null } {
  // questionId → { title, type }
  const qMap: Record<string, { title: string; type: string }> = {};
  for (const q of questions || []) {
    qMap[q.id] = { title: (q.title || "").trim(), type: (q.type || "").toUpperCase() };
  }

  let email: string | null = null;
  let phone: string | null = null;
  let name: string | null = null;

  for (const r of responses || []) {
    const q = qMap[r.questionId];
    const title = q?.title || "";
    const type = q?.type || "";
    let answer = r.answer;

    // Tally answer can be: string, number, array, or object
    let answerStr = "";
    if (typeof answer === "string") answerStr = answer.trim();
    else if (typeof answer === "number") answerStr = String(answer);
    else if (Array.isArray(answer)) answerStr = answer.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(", ");
    else if (typeof answer === "object" && answer != null) answerStr = JSON.stringify(answer);

    // EMAIL detection
    if (!email && (type === "INPUT_EMAIL" || /e-?mail/i.test(title))) {
      if (answerStr.includes("@")) email = answerStr.toLowerCase();
    }

    // PHONE detection — three signals:
    //  (a) Tally type is INPUT_PHONE_NUMBER
    //  (b) Question title matches phone keywords
    //  (c) Answer is a 10-13 digit number (after stripping non-digits)
    const labelPhone = /phone|mobile|whatsapp|contact\s*num|cell|^number$/i.test(title);
    const isPhoneType = type === "INPUT_PHONE_NUMBER";
    if (!phone && (isPhoneType || labelPhone)) {
      const digits = answerStr.replace(/\D/g, "");
      if (digits.length >= 10 && digits.length <= 13) phone = digits;
    }

    // NAME detection
    if (!name && (type === "INPUT_TEXT" && /^name|full[\s_-]?name|your[\s_-]?name/i.test(title))) {
      if (answerStr && answerStr.length < 200) name = answerStr;
    }
  }

  // Last-resort phone: any answer whose digit form is 10-13 digits
  if (!phone) {
    for (const r of responses || []) {
      let answerStr = "";
      const a = r.answer;
      if (typeof a === "string") answerStr = a;
      else if (typeof a === "number") answerStr = String(a);
      else continue;
      const digits = answerStr.replace(/\D/g, "");
      if (digits.length >= 10 && digits.length <= 13) {
        phone = digits;
        break;
      }
    }
  }

  return { email, phone, name };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const formIdParam = url.searchParams.get("form") || "ALL";
  const maxPages = Math.min(parseInt(url.searchParams.get("pages") || "10"), 50);
  const startPage = Math.max(1, parseInt(url.searchParams.get("startPage") || "1"));

  const formIds = formIdParam === "ALL"
    ? Object.keys(TALLY_FORM_TO_PROGRAM)
    : [formIdParam];

  const stats: any[] = [];
  let totalUpdated = 0;
  let totalScanned = 0;

  for (const formId of formIds) {
    const programInfo = TALLY_FORM_TO_PROGRAM[formId];
    if (!programInfo) {
      stats.push({ form: formId, error: "unknown form_id (not in map)" });
      continue;
    }

    let updated = 0;
    let scanned = 0;
    const matched: { email: string; phone: string; lead_id: string }[] = [];

    try {
      for (let pageOffset = 0; pageOffset < maxPages; pageOffset++) {
        const page = startPage + pageOffset;
        const data = await tallyFetch(`https://api.tally.so/forms/${formId}/submissions?page=${page}&limit=50`);
        const submissions = data.submissions || data.items || data.data || [];
        const questions = data.questions || [];
        if (submissions.length === 0) break;

        // Process in chunks of 20 in parallel to limit Supabase load
        for (let i = 0; i < submissions.length; i += 20) {
          const chunk = submissions.slice(i, i + 20);
          await Promise.all(chunk.map(async (s: any) => {
            scanned++;
            const { email, phone } = extractFromTally(s.responses || [], questions);
            if (!email || !phone) return;

            // Find lead by email + program where phone is null
            const { data: leads, error } = await supabase
              .from("leads")
              .select("id,phone,program")
              .eq("email", email.toLowerCase())
              .eq("program", programInfo.program)
              .is("phone", null)
              .limit(1);
            if (error || !leads || leads.length === 0) return;

            const normalized = normalizePhone(phone);
            if (!normalized) return;

            const { error: uerr } = await supabase
              .from("leads")
              .update({ phone: normalized })
              .eq("id", leads[0].id);
            if (!uerr) {
              updated++;
              if (matched.length < 5) matched.push({ email, phone: normalized, lead_id: leads[0].id });
            }
          }));
        }

        if (!data.hasMore) break;
      }

      stats.push({
        form: formId,
        program: programInfo.program,
        name: programInfo.name,
        startPage, pages_scanned: maxPages,
        scanned, updated,
        sample_matched: matched,
      });
      totalUpdated += updated;
      totalScanned += scanned;
    } catch (e: any) {
      stats.push({ form: formId, program: programInfo.program, error: e?.message });
    }
  }

  // After-state: count remaining NULL-phone leads
  const nullRes = await supabase.from("leads").select("*", { count: "exact", head: true }).is("phone", null);
  const totalRes = await supabase.from("leads").select("*", { count: "exact", head: true });

  return NextResponse.json({
    ok: true,
    stats,
    totals: {
      scanned_submissions: totalScanned,
      leads_phone_updated: totalUpdated,
      total_leads: totalRes.count,
      remaining_null_phone: nullRes.count,
      pct_filled: totalRes.count ? Math.round(1000 * (1 - (nullRes.count || 0) / totalRes.count)) / 10 : 0,
    },
  });
}
