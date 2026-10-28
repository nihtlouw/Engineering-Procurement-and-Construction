import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sessions } from "@/db/schema";
import { errorResponse, SESSION_COOKIE } from "@/lib/auth";

export async function POST() {
  try {
    const store = await cookies();
    const id = store.get(SESSION_COOKIE)?.value;
    if (id) await db.delete(sessions).where(eq(sessions.id, id));
    store.delete(SESSION_COOKIE);
    return Response.json({ data: { loggedOut: true } });
  } catch (error) { return errorResponse(error); }
}
