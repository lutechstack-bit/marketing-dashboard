// Debug: per-source attribution audit. Shows what's actually been hitting
// the Tally + Razorpay webhooks in production vs what's mapped to a program.
//
// GET /api/debug/sources

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { TALLY_FORM_TO_PROGRAM } from "@/lib/webhook-helpers";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "missing env" }, { status: 500 });
  }
  const admin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // ---- Tally side: what form_ids have we actually received? ----
  const formIdTally: Record<string, { count: number; program: string | null; sample_form_name: string | null }> = {};
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await admin
      .from("form_submissions")
      .select("form_id,form_name,program")
      .range(from, from + PAGE - 1);
    if (error) break;
    if (!data || data.length === 0) break;
    for (const r of data as any[]) {
      const fid = r.form_id || "(null)";
      if (!formIdTally[fid]) formIdTally[fid] = { count: 0, program: r.program, sample_form_name: r.form_name };
      formIdTally[fid].count++;
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }

  const mappedFormIds = new Set(Object.keys(TALLY_FORM_TO_PROGRAM));
  const tallyAudit = {
    mapped_in_code: Object.entries(TALLY_FORM_TO_PROGRAM).map(([id, v]) => ({
      form_id: id, program: v.program, name: v.name,
      submissions_received: formIdTally[id]?.count || 0,
    })),
    unmapped_form_ids: Object.entries(formIdTally)
      .filter(([id]) => !mappedFormIds.has(id) && id !== "(null)" && id !== "csv_import")
      .map(([id, info]) => ({ form_id: id, name: info.sample_form_name, count: info.count }))
      .sort((a, b) => b.count - a.count),
    csv_imports: formIdTally["csv_import"]?.count || 0,
    null_form_id: formIdTally["(null)"]?.count || 0,
  };

  // ---- Razorpay side: payment metadata audit ----
  // What programs are payments tagged with? How many payments have program=null?
  // What amounts are the program-null ones at?
  const paymentBreakdown: Record<string, { count: number; total_inr: number }> = {};
  const nullProgramByAmount: Record<string, { count: number; sample_payment_id: string }> = {};
  let pfrom = 0;
  while (true) {
    const { data, error } = await admin
      .from("payments")
      .select("id,program,amount_inr,payment_type,status,raw")
      .eq("status", "captured")
      .range(pfrom, pfrom + PAGE - 1);
    if (error) break;
    if (!data || data.length === 0) break;
    for (const p of data as any[]) {
      const key = `${p.program || "NULL"}|${p.payment_type || "unknown"}`;
      if (!paymentBreakdown[key]) paymentBreakdown[key] = { count: 0, total_inr: 0 };
      paymentBreakdown[key].count++;
      paymentBreakdown[key].total_inr += Number(p.amount_inr || 0);

      if (!p.program) {
        const amt = String(p.amount_inr);
        if (!nullProgramByAmount[amt]) nullProgramByAmount[amt] = { count: 0, sample_payment_id: p.id };
        nullProgramByAmount[amt].count++;
      }
    }
    if (data.length < PAGE) break;
    pfrom += PAGE;
  }

  // What raw Razorpay metadata is available that we could use for better attribution?
  // Sample a few null-program payments and show their raw `notes` / `description` / `payment_link_id`
  const { data: nullSamples } = await admin
    .from("payments")
    .select("id,amount_inr,raw")
    .eq("status", "captured")
    .is("program", null)
    .limit(10);

  const razorpayMetadataSamples = (nullSamples || []).map((p: any) => {
    const entity = p.raw?.payload?.payment?.entity || {};
    return {
      payment_id: p.id,
      amount_inr: p.amount_inr,
      notes: entity.notes || null,
      description: entity.description || null,
      payment_link_id: entity.payment_link_id || null,
      order_id: entity.order_id || null,
      method: entity.method || null,
      bank: entity.bank || null,
    };
  });

  return NextResponse.json({
    tally: tallyAudit,
    razorpay: {
      payment_breakdown: paymentBreakdown,
      null_program_by_amount: nullProgramByAmount,
      sample_null_program_metadata: razorpayMetadataSamples,
    },
  }, { headers: { "Cache-Control": "no-store" } });
}
