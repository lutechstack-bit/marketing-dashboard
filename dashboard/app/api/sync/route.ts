// Cron-triggered Meta Ads → Sheet sync. Replaces the Python version.
// Runs on Vercel cron (vercel.json schedule: 30 0 * * * = 6 AM IST daily).

import { NextResponse } from "next/server";
import { google } from "googleapis";
import { classifyCampaign } from "@/lib/parser";

const META_API = "https://graph.facebook.com/v21.0";
const GST = 0.18;

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const TRACKED_ACTIONS: Record<string, string> = {
  "lead": "lead",
  "offsite_conversion.fb_pixel_lead": "lead_pixel",
  "offsite_conversion.fb_pixel_purchase": "purchase_pixel",
  "purchase": "purchase",
};

async function metaGet(url: string): Promise<any> {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url);
    if (r.ok) return r.json();
    if ([429, 500, 502, 503, 504].includes(r.status)) {
      await new Promise(res => setTimeout(res, 1000 * (2 ** i))); continue;
    }
    throw new Error(`Meta API ${r.status}: ${await r.text()}`);
  }
  throw new Error("Meta API failed after retries");
}

async function listForgeCampaigns(token: string, account: string) {
  const out: { id: string; name: string; program: string }[] = [];
  let url: string | null = `${META_API}/${account}/campaigns?access_token=${token}&fields=id,name&limit=200`;
  while (url) {
    const d: any = await metaGet(url);
    for (const c of d.data || []) {
      const { program } = classifyCampaign(c.name);
      if (["FFM","FW","FC","FAI","AMBIGUOUS_FFM"].includes(program)) {
        out.push({ id: c.id, name: c.name, program: program === "AMBIGUOUS_FFM" ? "FFM" : program });
      }
    }
    url = d.paging?.next || null;
  }
  return out;
}

async function fetchInsights(token: string, campaigns: any[], since: string, until: string) {
  const fields = ["date_start","ad_id","ad_name","adset_name","campaign_id","campaign_name",
    "spend","impressions","reach","frequency","clicks","ctr","cpc","cpm","actions","action_values"].join(",");
  const tr = encodeURIComponent(JSON.stringify({since,until}));
  const fetchOne = async (c: any) => {
    let url: string | null = `${META_API}/${c.id}/insights?access_token=${token}&level=ad&time_increment=1&time_range=${tr}&fields=${fields}&limit=500`;
    const rows: any[] = [];
    while (url) {
      const d: any = await metaGet(url);
      rows.push(...(d.data || []));
      url = d.paging?.next || null;
    }
    return rows;
  };
  // 8-way concurrency
  const results: any[] = [];
  let idx = 0;
  await Promise.all(Array(8).fill(0).map(async () => {
    while (idx < campaigns.length) {
      const my = idx++;
      const r = await fetchOne(campaigns[my]);
      results.push(...r);
    }
  }));
  return results;
}

function extractActions(actions: any[], action_values: any[]) {
  const out: Record<string, number> = {};
  for (const k of Object.values(TRACKED_ACTIONS)) { out[k] = 0; out[`${k}_value`] = 0; }
  for (const a of (actions || [])) {
    const t = TRACKED_ACTIONS[a.action_type];
    if (t) out[t] += parseInt(a.value) || 0;
  }
  for (const a of (action_values || [])) {
    const t = TRACKED_ACTIONS[a.action_type];
    if (t) out[`${t}_value`] += parseFloat(a.value) || 0;
  }
  return out;
}

function buildDaily(insights: any[], campaignMap: Map<string, any>) {
  const rows: any[] = [];
  for (const r of insights) {
    const c = campaignMap.get(r.campaign_id); if (!c) continue;
    const acts = extractActions(r.actions, r.action_values);
    rows.push({
      date: r.date_start, program: c.program,
      campaign_id: r.campaign_id, campaign_name: r.campaign_name,
      adset_name: r.adset_name, ad_id: r.ad_id, ad_name: r.ad_name,
      spend: parseFloat(r.spend || "0"),
      impressions: parseInt(r.impressions || "0"),
      reach: parseInt(r.reach || "0"),
      frequency: parseFloat(r.frequency || "0"),
      clicks: parseInt(r.clicks || "0"),
      ctr: parseFloat(r.ctr || "0"),
      cpc: parseFloat(r.cpc || "0"),
      cpm: parseFloat(r.cpm || "0"),
      ...acts,
    });
  }
  rows.sort((a,b) => `${a.date}|${a.program}|${a.campaign_name}|${a.ad_name}`.localeCompare(`${b.date}|${b.program}|${b.campaign_name}|${b.ad_name}`));
  return rows;
}

function buildMonthly(daily: any[]) {
  const agg = new Map<string, any>();
  for (const r of daily) {
    const d = new Date(r.date);
    const k = `${r.program}|${d.getUTCFullYear()}|${d.getUTCMonth()+1}`;
    let v = agg.get(k);
    if (!v) {
      v = { program: r.program, year: d.getUTCFullYear(), month: d.getUTCMonth()+1,
            spend:0,impressions:0,reach:0,clicks:0,lead:0,lead_pixel:0,purchase_pixel:0,purchase_pixel_value:0 };
      agg.set(k, v);
    }
    v.spend += r.spend; v.impressions += r.impressions; v.reach += r.reach; v.clicks += r.clicks;
    v.lead += r.lead||0; v.lead_pixel += r.lead_pixel||0; v.purchase_pixel += r.purchase_pixel||0;
    v.purchase_pixel_value += r.purchase_pixel_value||0;
  }
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  return Array.from(agg.values()).sort((a,b) =>
    a.program.localeCompare(b.program) || a.year - b.year || a.month - b.month
  ).map(v => ({
    year: v.year, month: v.month, month_name: months[v.month-1], program: v.program,
    spend_inr_excl_gst: +v.spend.toFixed(2),
    spend_inr_incl_gst: +(v.spend * (1+GST)).toFixed(2),
    impressions: v.impressions, reach: v.reach, clicks: v.clicks,
    ctr_pct: v.impressions ? +(100*v.clicks/v.impressions).toFixed(2) : 0,
    cpc_inr: v.clicks ? +(v.spend/v.clicks).toFixed(2) : 0,
    cpm_inr: v.impressions ? +(v.spend/v.impressions*1000).toFixed(2) : 0,
    leads: v.lead + v.lead_pixel,
    cost_per_lead: (v.lead+v.lead_pixel) ? +(v.spend/(v.lead+v.lead_pixel)).toFixed(2) : 0,
    purchase_count: v.purchase_pixel,
    purchase_value: +v.purchase_pixel_value.toFixed(2),
  }));
}

function getSheets() {
  const json = process.env.GCP_SERVICE_ACCOUNT_JSON || "{}";
  const creds = JSON.parse(json);
  const auth = new google.auth.JWT({
    email: creds.client_email, key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

async function writeSheet(daily: any[]) {
  const sheets = getSheets();
  const spreadsheetId = process.env.SHEET_ID || "1b811ldC82v2GSOYGTzt7UokXDC8yy9RFv3Ffi0aXhK8";

  const newDates = Array.from(new Set(daily.map(r => r.date))).sort();
  const winMin = newDates[0], winMax = newDates[newDates.length-1];
  const headers = Object.keys(daily[0]);

  // Read current Daily tab
  let existing: any[][] = [];
  try {
    const r = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Meta Ads Daily" });
    existing = (r.data.values as any[][]) || [];
  } catch (e) { /* tab missing — will create */ }

  const kept: any[][] = [];
  if (existing.length > 1) {
    const eh = existing[0];
    const dateIdx = eh.indexOf("date");
    for (let i = 1; i < existing.length; i++) {
      const row = existing[i];
      if (!row || !row[dateIdx]) continue;
      if (row[dateIdx] < winMin || row[dateIdx] > winMax) {
        // Map old-row to current header order
        kept.push(headers.map(h => {
          const j = eh.indexOf(h);
          return j >= 0 ? row[j] : "";
        }));
      }
    }
  }
  const newRows = daily.map(r => headers.map(h => r[h]));
  const all = [...kept, ...newRows].sort((a,b) => String(a[0]).localeCompare(String(b[0])));
  const finalRows = [headers, ...all];

  // Clear + write Daily
  await sheets.spreadsheets.values.clear({ spreadsheetId, range: "Meta Ads Daily" }).catch(()=>{});
  await sheets.spreadsheets.values.update({
    spreadsheetId, range: "Meta Ads Daily!A1", valueInputOption: "USER_ENTERED",
    requestBody: { values: finalRows },
  });

  // Re-read Daily, build Monthly + Inputs-shaped from full data
  const fr = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Meta Ads Daily" });
  const fullRows = (fr.data.values as any[][]) || [];
  const objs = fullRows.slice(1).map(row => {
    const o: any = {};
    fullRows[0].forEach((h, i) => o[h] = row[i]);
    o.spend = parseFloat(o.spend) || 0;
    o.impressions = parseInt(o.impressions) || 0;
    o.reach = parseInt(o.reach) || 0;
    o.clicks = parseInt(o.clicks) || 0;
    ["lead","lead_pixel","purchase_pixel"].forEach(k => o[k] = parseInt(o[k]) || 0);
    o.purchase_pixel_value = parseFloat(o.purchase_pixel_value) || 0;
    return o;
  });
  const monthly = buildMonthly(objs);

  // Write Monthly
  if (monthly.length) {
    const mh = Object.keys(monthly[0]);
    const mRows = [mh, ...monthly.map(r => mh.map(k => (r as any)[k]))];
    await sheets.spreadsheets.values.clear({ spreadsheetId, range: "Meta Ads Monthly Rollup" }).catch(()=>{});
    await sheets.spreadsheets.values.update({
      spreadsheetId, range: "Meta Ads Monthly Rollup!A1", valueInputOption: "USER_ENTERED",
      requestBody: { values: mRows },
    });
  }

  // Inputs-shaped
  const months = Array.from(new Set(monthly.map(m => `${m.year}|${m.month}`))).map(s => {
    const [y, m] = s.split("|").map(Number); return { y, m };
  }).sort((a,b) => a.y-b.y || a.m-b.m);
  const monthName = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const byPM = new Map(monthly.map(m => [`${m.program}|${m.year}|${m.month}`, m]));
  const shaped: any[][] = [];
  shaped.push(["Year", ...months.map(x => x.y)]);
  shaped.push(["Month", ...months.map(x => monthName[x.m-1])]);
  for (const prog of ["FFM","FW","FC","FAI"]) {
    const row: any[] = [`${prog} Ads`];
    for (const x of months) {
      const r = byPM.get(`${prog}|${x.y}|${x.m}`);
      row.push(r ? r.spend_inr_incl_gst : 0);
    }
    shaped.push(row);
  }
  await sheets.spreadsheets.values.clear({ spreadsheetId, range: "Meta Ads Inputs Format" }).catch(()=>{});
  await sheets.spreadsheets.values.update({
    spreadsheetId, range: "Meta Ads Inputs Format!A1", valueInputOption: "USER_ENTERED",
    requestBody: { values: shaped },
  });

  return { daily_pushed: daily.length, monthly_total: monthly.length, window_min: winMin, window_max: winMax };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("status") === "1") {
    return NextResponse.json({ status: "alive", time: new Date().toISOString() });
  }
  try {
    const days = parseInt(url.searchParams.get("days") || "7");
    const token = process.env.META_ACCESS_TOKEN!;
    const account = process.env.META_AD_ACCOUNT_ID_API!;
    const until = new Date(); const since = new Date(Date.now() - days*86400_000);
    const sinceStr = since.toISOString().slice(0,10), untilStr = until.toISOString().slice(0,10);

    const campaigns = await listForgeCampaigns(token, account);
    const insights = await fetchInsights(token, campaigns, sinceStr, untilStr);
    const cMap = new Map(campaigns.map(c => [c.id, c]));
    const daily = buildDaily(insights, cMap);
    if (!daily.length) return NextResponse.json({ status: "no_data", since: sinceStr, until: untilStr, campaigns: campaigns.length });

    const result = await writeSheet(daily);
    return NextResponse.json({ status: "ok", since: sinceStr, until: untilStr, campaigns: campaigns.length, raw_insights: insights.length, ...result });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e), stack: e?.stack?.split("\n").slice(0,8) }, { status: 500 });
  }
}
