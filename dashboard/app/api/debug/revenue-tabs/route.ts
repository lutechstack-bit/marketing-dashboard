// Debug: dump the column headers + first 5 rows of every tab in the
// Revenue Tracker sheet so we can find a per-program breakdown.
//
// GET /api/debug/revenue-tabs

import { NextResponse } from "next/server";
import { google } from "googleapis";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const json = process.env.GCP_SERVICE_ACCOUNT_JSON;
  const sheetId = process.env.REVENUE_SHEET_ID || "1Tf2jiDSPE-P3FgrPWgbtij_7bgk9rGXTaRny8JZd8ck";
  if (!json) return NextResponse.json({ error: "missing GCP_SERVICE_ACCOUNT_JSON" }, { status: 500 });

  const creds = JSON.parse(json);
  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  await auth.authorize();
  const sheets = google.sheets({ version: "v4", auth });

  // List all tabs
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId, includeGridData: false });
  const tabs = (meta.data.sheets || []).map(s => ({
    title: s.properties?.title || "?",
    rows: s.properties?.gridProperties?.rowCount || 0,
    cols: s.properties?.gridProperties?.columnCount || 0,
  }));

  // For each tab, fetch first 5 rows
  const samples: Record<string, { header: string[]; rows: any[][] }> = {};
  const ranges = tabs.map(t => `${t.title}!A1:Z6`);
  const batch = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: sheetId,
    ranges,
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  (batch.data.valueRanges || []).forEach((vr, i) => {
    const rows = (vr.values || []) as any[][];
    samples[tabs[i].title] = {
      header: (rows[0] || []).map(String),
      rows: rows.slice(1, 6),
    };
  });

  return NextResponse.json({
    sheet_id: sheetId,
    tabs,
    samples,
  }, { headers: { "Cache-Control": "no-store" } });
}
