import { google } from "googleapis";

const SHEET_ID = process.env.SHEET_ID || "1b811ldC82v2GSOYGTzt7UokXDC8yy9RFv3Ffi0aXhK8";

function getServiceAccountAuth() {
  const json = process.env.GCP_SERVICE_ACCOUNT_JSON || "{}";
  const creds = JSON.parse(json);
  return new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
}

export async function readTab(tab: string): Promise<string[][]> {
  const auth = getServiceAccountAuth();
  await auth.authorize();
  const sheets = google.sheets({ version: "v4", auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: tab,
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  return (res.data.values as string[][]) || [];
}

export async function readMultipleTabs(tabs: string[]): Promise<Record<string, string[][]>> {
  const auth = getServiceAccountAuth();
  await auth.authorize();
  const sheets = google.sheets({ version: "v4", auth });
  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: SHEET_ID,
    ranges: tabs,
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const out: Record<string, string[][]> = {};
  (res.data.valueRanges || []).forEach((vr, i) => {
    out[tabs[i]] = (vr.values as string[][]) || [];
  });
  return out;
}

// Parse helpers
export function tableToObjects(rows: string[][]): Record<string, any>[] {
  if (!rows || rows.length < 2) return [];
  const [header, ...body] = rows;
  return body.map((r) => {
    const obj: Record<string, any> = {};
    header.forEach((k, i) => (obj[k] = r[i]));
    return obj;
  });
}
