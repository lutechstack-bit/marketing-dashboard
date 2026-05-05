import Header from "@/components/Header";
import { getCurrentRep } from "@/lib/auth/supabase-server";
import { redirect } from "next/navigation";
import ImportClient from "@/components/admin/ImportClient";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const rep = await getCurrentRep();
  if (!rep) redirect("/login?next=/admin/import");
  if (rep.role !== "admin" && rep.role !== "founder") redirect("/");

  return (
    <>
      <Header />
      <main className="max-w-[1300px] mx-auto px-6 py-6">
        <ImportClient />
      </main>
    </>
  );
}
