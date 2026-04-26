// Manual marketing spend CRUD — for YouTube collabs, influencer fees, etc.
//
// GET    /api/spend           → list rows (newest first, optional ?since=YYYY-MM-DD)
// POST   /api/spend           → add row { channel, source_name, date, amount_inr, program?, utm_tag?, notes? }
// DELETE /api/spend?id=...    → remove row
//
// Requires manual_marketing_spend table to exist — see supabase/manual_marketing_spend.sql
// for the one-time migration the user runs in Supabase SQL Editor.

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const VALID_CHANNELS = new Set(["youtube_collab", "influencer", "agency", "newsletter", "event", "other"]);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const since = url.searchParams.get("since");
  let q = supabase.from("manual_marketing_spend").select("*").order("date", { ascending: false }).limit(500);
  if (since) q = q.gte("date", since);
  const { data, error } = await q;
  if (error) {
    // Friendly error if table missing
    if (error.message?.includes("relation") || error.message?.includes("does not exist")) {
      return NextResponse.json({
        error: "manual_marketing_spend table not found",
        setup: "Run the SQL in supabase/manual_marketing_spend.sql in your Supabase SQL Editor (one-time setup).",
      }, { status: 503 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ spend: data || [] });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { channel = "youtube_collab", source_name, date, amount_inr, program, utm_tag, notes } = body || {};
    if (!date || !amount_inr) {
      return NextResponse.json({ error: "date and amount_inr are required" }, { status: 400 });
    }
    if (!VALID_CHANNELS.has(channel)) {
      return NextResponse.json({ error: `unknown channel '${channel}'` }, { status: 400 });
    }
    const { data, error } = await supabase
      .from("manual_marketing_spend")
      .insert({ channel, source_name, date, amount_inr, program: program || null, utm_tag: utm_tag || null, notes: notes || null })
      .select()
      .single();
    if (error) {
      if (error.message?.includes("relation") || error.message?.includes("does not exist")) {
        return NextResponse.json({ error: "table not found", setup: "Run supabase/manual_marketing_spend.sql first" }, { status: 503 });
      }
      throw error;
    }
    return NextResponse.json({ ok: true, spend: data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const { error } = await supabase.from("manual_marketing_spend").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
