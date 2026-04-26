// Razorpay webhook receiver — fires on payment events.
//
// Setup: Razorpay Dashboard → Settings → Webhooks → Add Webhook
//   URL:    https://forge-marketing-sync.vercel.app/api/webhook/razorpay?account=admin
//   Secret: (generate random, save it as RZP_ADMIN_WEBHOOK_SECRET in Vercel env)
//   Events: payment.captured, payment.failed, payment.authorized
//
// For the Edtech RP account, use ?account=edtech and set RZP_EDTECH_WEBHOOK_SECRET.
//
// Signature: Razorpay signs the raw body with HMAC SHA-256 and the webhook secret,
// then sends X-Razorpay-Signature as a hex digest. We verify before processing.

import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabase } from "@/lib/supabase";
import { inferPaymentType, findLead, normalizePhone } from "@/lib/webhook-helpers";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function verifySignature(body: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch { return false; }
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const account = url.searchParams.get("account") === "edtech" ? "edtech" : "admin";

  const raw = await req.text();
  let body: any;
  try { body = JSON.parse(raw); }
  catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  const secretEnv = account === "edtech" ? "RZP_EDTECH_WEBHOOK_SECRET" : "RZP_ADMIN_WEBHOOK_SECRET";
  const secret = process.env[secretEnv];
  if (secret) {
    const sig = req.headers.get("x-razorpay-signature");
    if (!verifySignature(raw, sig, secret)) {
      console.warn(`[razorpay-webhook:${account}] signature mismatch`);
      return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }
  } else {
    console.warn(`[razorpay-webhook:${account}] ${secretEnv} not set — skipping signature verification (DEV ONLY)`);
  }

  try {
    const event = body?.event;
    const payment = body?.payload?.payment?.entity;
    if (!event || !payment) {
      return NextResponse.json({ error: "missing event or payment entity" }, { status: 400 });
    }

    const amountInr = (payment.amount || 0) / 100;
    const inferred = inferPaymentType(amountInr);

    // Try to match the payment to an existing lead (by email or phone)
    const lead = await findLead({
      email: payment.email,
      phone: normalizePhone(payment.contact),
      program: inferred.program, // optional scope
    });

    // Upsert the payment row (idempotent by PK = payment.id)
    await supabase.from("payments").upsert({
      id:           payment.id,
      lead_id:      lead?.id || null,
      account,
      program:      inferred.program || lead?.program || null,
      payment_type: inferred.payment_type,
      amount_inr:   amountInr,
      status:       payment.status,  // captured | failed | authorized | refunded
      email:        payment.email || null,
      phone:        normalizePhone(payment.contact),
      paid_at:      payment.created_at ? new Date(payment.created_at * 1000).toISOString() : new Date().toISOString(),
      raw:          body,
    });

    // Update lead funnel_stage on captured app fee / confirmation / full
    if (lead && payment.status === "captured") {
      let newStage: string | null = null;
      if (inferred.payment_type === "app_fee")      newStage = "accepted";
      else if (inferred.payment_type === "confirmation") newStage = "confirmed";
      else if (inferred.payment_type === "full")    newStage = "balance_paid";

      if (newStage) {
        await supabase.from("leads").update({
          funnel_stage: newStage,
          last_activity: new Date().toISOString(),
        }).eq("id", lead.id);
      }
    }

    console.log(`[razorpay-webhook:${account}] event=${event} amount=${amountInr} type=${inferred.payment_type} lead=${lead?.id} email=${payment.email}`);
    return NextResponse.json({ ok: true, payment_id: payment.id, lead_id: lead?.id });
  } catch (e: any) {
    console.error(`[razorpay-webhook:${account}] error:`, e?.message);
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const account = url.searchParams.get("account") === "edtech" ? "edtech" : "admin";
  return NextResponse.json({
    status: "alive",
    receiver: "razorpay",
    account,
    docs: "POST Razorpay webhook payloads here — see route.ts header for setup.",
  });
}
