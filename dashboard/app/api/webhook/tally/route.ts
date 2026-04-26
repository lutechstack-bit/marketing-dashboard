// Tally webhook receiver — fires on form submission.
//
// Setup: in each Tally form's settings → Integrations → Webhooks, add this URL:
//   https://forge-marketing-sync.vercel.app/api/webhook/tally
//
// Tally only fires on COMPLETE submissions by default. (Partials still need the
// Python ingest_tally.py script for backfill — webhook handles forward flow.)
//
// Optional signature verification: set TALLY_SIGNING_SECRET in Vercel env;
// receiver will verify the `tally-signature` HMAC SHA-256 header against the body.

import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabase } from "@/lib/supabase";
import { TALLY_FORM_TO_PROGRAM, tallyExtractFields, upsertLead, normalizePhone } from "@/lib/webhook-helpers";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function verifySignature(body: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export async function POST(req: Request) {
  const raw = await req.text();
  let body: any;
  try { body = JSON.parse(raw); }
  catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  const secret = process.env.TALLY_SIGNING_SECRET;
  if (secret) {
    const sig = req.headers.get("tally-signature");
    if (!verifySignature(raw, sig, secret)) {
      console.warn("[tally-webhook] signature mismatch");
      return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }
  }

  try {
    const data = body?.data || {};
    const formId = data.formId;
    const submissionId = data.submissionId || data.responseId;
    if (!formId || !submissionId) {
      return NextResponse.json({ error: "missing formId or submissionId" }, { status: 400 });
    }

    const programInfo = TALLY_FORM_TO_PROGRAM[formId];
    if (!programInfo) {
      console.warn(`[tally-webhook] unknown form_id ${formId}, ignoring`);
      return NextResponse.json({ ok: true, ignored: true, reason: "unknown form_id" });
    }

    const { email, phone, name, responses } = tallyExtractFields(data.fields || []);

    // Pull UTMs from hidden fields if Tally captured them
    const utms = {
      utm_source:   responses["utm_source"]   || null,
      utm_medium:   responses["utm_medium"]   || null,
      utm_campaign: responses["utm_campaign"] || null,
      utm_content:  responses["utm_content"]  || null,
    };

    // Upsert lead — completed submission flips funnel_stage to form_submitted
    const lead = await upsertLead({
      email, phone, name,
      program: programInfo.program,
      funnel_stage: "form_submitted",
      source_utm_source:   utms.utm_source,
      source_utm_medium:   utms.utm_medium,
      source_utm_campaign: utms.utm_campaign,
    });

    // Insert form_submissions row (idempotent: PRIMARY KEY = submissionId)
    await supabase.from("form_submissions").upsert({
      id:           submissionId,
      lead_id:      lead?.id || null,
      form_id:      formId,
      form_name:    programInfo.name,
      program:      programInfo.program,
      is_completed: true,
      submitted_at: data.createdAt || new Date().toISOString(),
      email:        email || null,
      phone:        normalizePhone(phone),
      name:         name || null,
      responses,
      raw:          body,
    });

    console.log(`[tally-webhook] ok form=${formId} program=${programInfo.program} lead=${lead?.id} email=${email}`);
    return NextResponse.json({ ok: true, lead_id: lead?.id });
  } catch (e: any) {
    console.error("[tally-webhook] error:", e?.message, e?.stack?.split("\n").slice(0, 3));
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

// Health-check GET so we can curl the URL to verify it's deployed.
export async function GET() {
  return NextResponse.json({
    status: "alive",
    receiver: "tally",
    accepted_forms: Object.entries(TALLY_FORM_TO_PROGRAM).map(([id, p]) => ({ form_id: id, program: p.program, name: p.name })),
    docs: "POST Tally webhook payloads here — see route.ts header for setup.",
  });
}
