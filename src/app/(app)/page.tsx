import { getCurrentUser } from "@/lib/auth";
import { getWorkspaceData } from "@/lib/workspace";
import LoginScreen from "@/components/LoginScreen";
import EPCApp from "@/components/EPCApp";
import type { AppData } from "@/components/types";
import { withCompany } from "@/shared/auth/route";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getCurrentUser();
  // S1: tidak ada lagi password demo yang dicetak ke halaman login.
  if (!user) return <LoginScreen />;
  // SEMUA pembacaan workspace wajib berada di dalam scope company (RLS FORCE).
  const data = await withCompany(user, () => getWorkspaceData(user));
  return <EPCApp initialData={data as AppData} />;
}
