import Header from "@/components/Header";
import { supabase } from "@/lib/supabase";
import { getCurrentRep } from "@/lib/auth/supabase-server";
import { redirect } from "next/navigation";
import TeamClient from "@/components/admin/TeamClient";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const rep = await getCurrentRep();
  if (!rep) redirect("/login?next=/admin/team");
  if (rep.role !== "admin" && rep.role !== "founder") redirect("/");

  const [repsRes, assignmentsRes, productsRes] = await Promise.all([
    supabase.from("sales_reps").select("*").order("role").order("full_name"),
    supabase.from("rep_assignments").select("*").eq("active", true),
    supabase.from("products").select("*").eq("active", true).order("display_order"),
  ]);

  return (
    <>
      <Header />
      <main className="max-w-[1300px] mx-auto px-6 py-6">
        <TeamClient
          reps={(repsRes.data || []) as any[]}
          assignments={(assignmentsRes.data || []) as any[]}
          products={(productsRes.data || []) as any[]}
          currentRepId={rep.id}
        />
      </main>
    </>
  );
}
