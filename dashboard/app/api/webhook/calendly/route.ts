// Calendly webhook receiver — fires on invitee.created and invitee.canceled.
//
// Setup: registered programmatically via the Calendly API (the token has
//   webhooks:write scope). See /api/webhook/calendly/register for one-off setup.
//
// Calendly signature: header "Calendly-Webhook-Signature: t=<ts>,v1=<sig>"
//   We compute HMAC SHA-256 of `<ts>.<body>` with the signing key returned at
//   subscription-creation time. Stored in CALENDLY_WEBHOOK_SIGNING_KEY env.

import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabase } from "@/lib/supabase";
import { findLead, normalizePhone } from "@/lib/webhook-helpers";
import { EVENT_TO_PROGRAM } from "@/lib/calendly";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function verifyCalendlySignature(body: string, header: string | null, key: string): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map(p => p.trim().split("=")));
  const t = parts["t"];
  const v1 = parts["v1"];
  if (!t || !v1) return false;
  const expected = crypto.createHmac("sha256", key).update(`${t}.${body}`).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
  } catch { return false; }
}

export async function POST(req: Request) {
  const raw = await req.text();
  let body: any;
  try { body = JSON.parse(raw); }
  catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  const key = process.env.CALENDLY_WEBHOOK_SIGNING_KEY;
  if (key) {
    const sig = req.headers.get("calendly-webhook-signature");
    if (!verifyCalendlySignature(raw, sig, key)) {
      console.warn("[calendly-webhook] signature mismatch");
      return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }
  } else {
    console.warn("[calendly-webhook] CALENDLY_WEBHOOK_SIGNING_KEY not set — skipping verification (DEV ONLY)");
  }

  try {
    const eventName: string = body?.event;
    const payload: any = body?.payload || {};

    // invitee.created / invitee.canceled — the invitee fields differ slightly
    const email: string | null = (payload.email || payload.invitee?.email || "").toLowerCase() || null;
    const name: string | null = payload.name || payload.invitee?.name || null;
    const eventTypeName: string = (payload.event_type?.name || payload.scheduled_event?.name || "").trim();
    const program = EVENT_TO_PROGRAM[eventTypeName] || null;

    if (!email) {
      console.warn(`[calendly-webhook] no invitee email in ${eventName}`);
      return NextResponse.json({ ok: true, ignored: true, reason: "no email" });
    }

    // Find the lead. Calendly bookings come AFTER the Tally form submission +
    // app fee, so the lead should already exist. If it doesn't, we just log
    // for the lead-detail page to render later (once Tally form arrives).
    const lead = await findLead({ email, program });

    if (lead) {
      // Booking made → bump last_activity. We don't move stage here; that's
      // driven by Razorpay (app fee) and rep status updates.
      await supabase.from("leads").update({
        last_activity: new Date().toISOString(),
      }).eq("id", lead.id);
    }

    console.log(`[calendly-webhook] ${eventName} email=${email} event_type='${eventTypeName}' program=${program} lead=${lead?.id || "—"}`);
    return NextResponse.json({ ok: true, lead_id: lead?.id || null });
  } catch (e: any) {
    console.error("[calendly-webhook] error:", e?.message);
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    status: "alive",
    receiver: "calendly",
    docs: "POST Calendly webhook payloads here — registered programmatically via /api/webhook/calendly/register",
  });
}
