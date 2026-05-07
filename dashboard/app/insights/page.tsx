// /insights → /dashboard (merged into the homepage). Redirect preserves
// any deep-link params someone might have bookmarked.

import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function InsightsRedirect({ searchParams }: { searchParams: Promise<{ [k: string]: string | string[] | undefined }> }) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string") qs.set(k, v);
    else if (Array.isArray(v)) qs.set(k, v.join(","));
  }
  // Default Insights consumers expect the analytics view → revenue + timelines
  if (!qs.has("view"))  qs.set("view", "marketing");
  if (!qs.has("slice")) qs.set("slice", "timelines");
  redirect(`/?${qs.toString()}`);
}
