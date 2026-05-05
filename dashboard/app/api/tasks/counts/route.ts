// GET /api/tasks/counts → { overdue, today, total } for the logged-in rep.
// Drives the header bell badge.

import { NextResponse } from "next/server";
import { getCurrentRep } from "@/lib/auth/supabase-server";
import { fetchTaskCountForRep } from "@/lib/tasks";

export const dynamic = "force-dynamic";

export async function GET() {
  const rep = await getCurrentRep();
  if (!rep) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const counts = await fetchTaskCountForRep(rep.id);
  return NextResponse.json(counts);
}
