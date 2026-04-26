// One-off registration endpoint — hits Calendly's API to create a webhook subscription
// pointing at our /api/webhook/calendly receiver. Run once after deploy.
//
// Curl: GET https://forge-marketing-sync.vercel.app/api/webhook/calendly/register
//
// Returns the signing key (which you should then save to Vercel env as
// CALENDLY_WEBHOOK_SIGNING_KEY for signature verification).

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const CAL_API = "https://api.calendly.com";

export async function GET(req: Request) {
  const TOKEN = process.env.CALENDLY_TOKEN;
  const ORG_URI = process.env.CALENDLY_ORG_URI;
  if (!TOKEN || !ORG_URI) {
    return NextResponse.json({ error: "CALENDLY_TOKEN / CALENDLY_ORG_URI not set in env" }, { status: 500 });
  }

  // Build the receiver URL from the request itself so it works in preview + prod
  const reqUrl = new URL(req.url);
  const receiver = `${reqUrl.origin}/api/webhook/calendly`;

  // List existing subscriptions first — don't double-register
  const list = await fetch(
    `${CAL_API}/webhook_subscriptions?organization=${encodeURIComponent(ORG_URI)}&scope=organization&count=100`,
    { headers: { Authorization: `Bearer ${TOKEN}` } }
  ).then(r => r.json());

  const existing = (list.collection || []).find((s: any) => s.callback_url === receiver);
  if (existing) {
    return NextResponse.json({
      ok: true,
      already_registered: true,
      subscription: existing,
      receiver,
      note: "Webhook already exists. To rotate signing key, delete and re-register via Calendly dashboard.",
    });
  }

  // Create the webhook subscription
  const r = await fetch(`${CAL_API}/webhook_subscriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url: receiver,
      events: ["invitee.created", "invitee.canceled"],
      organization: ORG_URI,
      scope: "organization",
    }),
  });
  const json = await r.json();
  if (!r.ok) {
    return NextResponse.json({ error: "Calendly registration failed", detail: json }, { status: r.status });
  }

  return NextResponse.json({
    ok: true,
    receiver,
    subscription: json.resource,
    next_steps: [
      "Copy the 'signing_key' value from `subscription` above",
      "Add it to Vercel project env as CALENDLY_WEBHOOK_SIGNING_KEY",
      "Redeploy so the receiver picks it up (signature verification turns on)",
    ],
  });
}
