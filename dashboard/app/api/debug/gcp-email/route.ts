// Debug: return only the client_email of the GCP service account (no
// secrets, no key material). Used to know which email to share Sheets with.
//
// GET /api/debug/gcp-email

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const raw = process.env.GCP_SERVICE_ACCOUNT_JSON;
  if (!raw) return NextResponse.json({ error: "GCP_SERVICE_ACCOUNT_JSON not set" }, { status: 500 });
  try {
    const j = JSON.parse(raw);
    return NextResponse.json({
      client_email: j.client_email || null,
      project_id: j.project_id || null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json({ error: `parse failed: ${e.message}` }, { status: 500 });
  }
}
