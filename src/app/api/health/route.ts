import { publicRoute } from "@/shared/auth/route";
import { db } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

async function GETHandler() {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Database health check failed", error);
    return Response.json({ ok: false }, { status: 500 });
  }
}

export const GET = publicRoute(GETHandler);
