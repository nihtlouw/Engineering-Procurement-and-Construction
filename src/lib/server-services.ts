import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { activityLogs, projectMembers, projects } from "@/db/schema";
import { ApiError, hasPermission } from "@/lib/auth";
import type { Permission, SafeUser } from "@/lib/domain";

export const newId = () => randomUUID();

export async function requireProject(user: SafeUser, projectId: string, permission?: Permission, allowLocked = false) {
  if (permission) {
    if (!hasPermission(user, permission)) throw new ApiError("FORBIDDEN", `Anda tidak memiliki izin ${permission}.`, 403);
  }
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) throw new ApiError("NOT_FOUND", "Proyek tidak ditemukan.", 404);
  if (user.role !== "ADMIN") {
    const [membership] = await db.select().from(projectMembers).where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, user.id))).limit(1);
    if (!membership) throw new ApiError("PROJECT_SCOPE_DENIED", "Anda bukan anggota proyek ini.", 403);
  }
  if (project.isLocked && !allowLocked) throw new ApiError("PROJECT_LOCKED", "Proyek COMPLETED terkunci. Gunakan koreksi admin beralasan.", 409);
  return project;
}

export async function audit(input: {
  actorId: string; objectType: string; objectId: string; projectId?: string | null; action: string;
  changes?: { field: string; old: unknown; new: unknown }[]; reason?: string;
}) {
  await db.insert(activityLogs).values({ id: newId(), actorId: input.actorId, objectType: input.objectType, objectId: input.objectId, projectId: input.projectId, action: input.action, changes: input.changes ?? null, reason: input.reason });
}

export function requiredReason(reason: unknown, label = "Alasan") {
  if (typeof reason !== "string" || reason.trim().length < 5) throw new ApiError("REASON_REQUIRED", `${label} wajib diisi minimal 5 karakter.`, 422);
  return reason.trim();
}

export function assertTransition(transitions: Record<string, Record<string, string>>, current: string, action: string) {
  const next = transitions[current]?.[action];
  if (!next) throw new ApiError("INVALID_TRANSITION", `Aksi ${action} tidak valid untuk status ${current}.`, 409);
  return next;
}

export function asJsonErrorDetails(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
