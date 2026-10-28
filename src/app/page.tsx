import { ensureSeed } from "@/db/seed";
import { getCurrentUser } from "@/lib/auth";
import { getWorkspaceData } from "@/lib/workspace";
import LoginScreen from "@/components/LoginScreen";
import EPCApp from "@/components/EPCApp";
import type { AppData } from "@/components/types";

export const dynamic = "force-dynamic";
export default async function HomePage() {
  await ensureSeed(); const user = await getCurrentUser();
  if (!user) return <LoginScreen demoPassword={process.env.SEED_DEMO_PASSWORD ? null : "DemoEPC2026!"} />;
  const data = await getWorkspaceData(user);
  return <EPCApp initialData={data as AppData} />;
}
