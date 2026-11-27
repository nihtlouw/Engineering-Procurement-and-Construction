import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  activityLogs, budgetLines, progressUpdates, projectWbsCalendars, projects, scheduleItems, users,
} from "@/db/schema";
import { ApiError, hasPermission } from "@/lib/auth";
import type { SessionUser } from "@/lib/domain";
import { formatDate, todayJakarta } from "@/lib/format";
import { newId, requireProject, requiredReason } from "@/lib/server-services";
import {
  actualIncrementByPeriod, buildSCurve, normalizeWeights, summarizeWeights, WEIGHT_TOLERANCE,
  type SCurve, type WbsItemLike,
} from "@/modules/wbs/types";
import type { SaveWbsInput, WbsItemInput } from "@/modules/wbs/validation";

/* -------------------------------------------------------------------------- */
/* S5 · WBS: CRUD, Σ bobot 100%, kalender & kurva-S                            */
/* -------------------------------------------------------------------------- */

const WBS_CREATE = "schedule.edit" as const;

function canEditWbs(user: SessionUser) {
  return hasPermission(user, WBS_CREATE) || hasPermission(user, "progress.create");
}

function assertCanEditWbs(user: SessionUser) {
  if (!canEditWbs(user)) {
    throw new ApiError("FORBIDDEN", "Izin schedule.edit diperlukan untuk mengubah WBS.", 403);
  }
}

const toWbs = (row: typeof scheduleItems.$inferSelect): WbsItemLike => ({
  id: row.id,
  parentId: row.parentId,
  level: row.level,
  weight: row.weight ?? "0",
  progressPct: row.progressPct ?? "0",
  isSummary: row.isSummary,
  plannedStart: row.plannedStart,
  plannedEnd: row.plannedEnd,
  actualStart: row.actualStart,
  actualEnd: row.actualEnd,
  sortOrder: row.sortOrder,
  code: row.code,
  name: row.name,
});

/**
 * Kode WBS otomatis: level 1 → `WBS-003`, anak → `3.1`, cucu → `3.1.2`.
 * Segmen induk dinormalkan (tanpa nol di depan) agar kode tetap pendek.
 */
export function buildWbsCode(level: number, sortOrder: number, parentCode?: string | null) {
  if (parentCode) {
    const parent = parentCode.replace(/^WBS-/, "").split(".")
      .map((segment) => String(Number(segment) || 0));
    return `${parent.join(".")}.${sortOrder + 1}`;
  }
  return `WBS-${String(sortOrder + 1).padStart(3, "0")}`;
}

function normalizeItems(items: WbsItemInput[]) {
  // Urutan tersimpan = urutan kiriman; item ringkasan selalu punya bobot 0.
  return items.map((item, index) => ({
    ...item,
    sortOrder: index,
    weight: item.isSummary ? "0" : item.weight,
    code: item.code?.trim() || null,
  }));
}

function assertHierarchy(items: ReturnType<typeof normalizeItems>) {
  const ids = new Set(items.map((item) => item.id).filter((id): id is string => !!id));
  for (const item of items) {
    if (item.parentId && !ids.has(item.parentId) && !["tmp", "new"].some((prefix) => item.parentId!.startsWith(prefix))) {
      // Parent baru (tanpa id) dikirim sebagai `new`/`tmp`; selain itu harus ada.
      throw new ApiError("WBS_PARENT_UNKNOWN", `Induk untuk "${item.name}" tidak ditemukan pada daftar.`, 422);
    }
    if (item.parentId && item.level <= 1) {
      throw new ApiError("WBS_LEVEL_INVALID", `"${item.name}" punya induk tetapi level 1.`, 422);
    }
  }
}

/** Simpan WBS sebagai satu kesatuan (replace-by-set) dalam satu transaksi. */
export async function saveWbs(user: SessionUser, projectId: string, input: SaveWbsInput) {
  await requireProject(user, projectId);
  assertCanEditWbs(user);

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) throw new ApiError("NOT_FOUND", "Proyek tidak ditemukan.", 404);
  if (project.isLocked && user.companyRole !== "ADMIN") {
    throw new ApiError("PROJECT_LOCKED", "Proyek COMPLETED terkunci. Hanya ADMIN yang dapat mengubah WBS.", 409);
  }

  const items = normalizeItems(input.items);
  assertHierarchy(items);

  const summary = summarizeWeights(items.map((item) => ({
    id: item.id ?? "new", parentId: item.parentId ?? null, level: item.level,
    weight: item.weight, progressPct: item.progressPct, isSummary: item.isSummary,
    plannedStart: item.plannedStart ?? null, plannedEnd: item.plannedEnd ?? null, sortOrder: item.sortOrder,
  })));
  if (summary.warning && !input.allowIncomplete && Math.abs(summary.activityWeight - 100) > WEIGHT_TOLERANCE) {
    throw new ApiError("WBS_WEIGHT_TOTAL", summary.warning, 422, { activityWeight: summary.activityWeight });
  }

  const existing = await db.select().from(scheduleItems).where(eq(scheduleItems.projectId, projectId));
  const existingIds = new Set(existing.map((row) => row.id));
  const usedIds = new Set<string>();
  const idMap = new Map<string, string>(); // id kiriman (lama atau baru) → id tersimpan
  const counters = new Map<number, number>(); // level → urutan untuk kode otomatis

  await db.transaction(async (tx) => {
    for (const item of items) {
      const parentStored = item.parentId ? (existingIds.has(item.parentId) ? item.parentId : idMap.get(item.parentId) ?? null) : null;
      const level = parentStored ? Math.max(2, item.level) : 1;
      const levelIndex = (counters.get(level) ?? 0);
      counters.set(level, levelIndex + 1);
      const parentCode = parentStored ? existing.find((row) => row.id === parentStored)?.code ?? null : null;
      const code = item.code ?? buildWbsCode(level, levelIndex, parentCode);
      const values = {
        projectId, parentId: parentStored, type: item.type, name: item.name.trim(), code,
        level, isSummary: item.isSummary, weight: item.weight, progressPct: item.progressPct,
        status: Number(item.progressPct) >= 100 ? "DONE" : Number(item.progressPct) > 0 ? "IN_PROGRESS" : "NOT_STARTED",
        plannedStart: item.plannedStart || null, plannedEnd: item.plannedEnd || null,
        ownerId: item.ownerId ?? null, sortOrder: item.sortOrder, parentSortOrder: item.sortOrder,
      };
      if (item.id && existingIds.has(item.id)) {
        await tx.update(scheduleItems).set(values).where(eq(scheduleItems.id, item.id));
        usedIds.add(item.id);
        idMap.set(item.id, item.id);
      } else {
        const id = newId();
        await tx.insert(scheduleItems).values({ id, ...values });
        usedIds.add(id);
        if (item.id) idMap.set(item.id, id);
        if (!item.id) idMap.set(`new:${item.sortOrder}`, id);
      }
    }

    // Item lama yang tidak dikirim lagi dihapus BESERTA progresnya (cascade).
    const removals = existing.filter((row) => !usedIds.has(row.id));
    if (removals.length) {
      await tx.delete(scheduleItems).where(inArray(scheduleItems.id, removals.map((row) => row.id)));
    }

    const recomputed = await tx.select().from(scheduleItems).where(eq(scheduleItems.projectId, projectId));
    const summaryAfter = summarizeWeights(recomputed.map(toWbs));
    await upsertCalendar(tx, user, projectId, summaryAfter, input);

    await tx.insert(activityLogs).values({
      id: newId(), actorId: user.id, objectType: "WBS_ITEM", objectId: projectId, projectId,
      action: "WBS_SAVED",
      reason: input.note ?? null,
      changes: [
        { field: "itemCount", old: existing.length, new: recomputed.length },
        { field: "removed", old: null, new: removals.length },
        { field: "totalWeight", old: null, new: summaryAfter.activityWeight },
        { field: "weightedProgress", old: null, new: summaryAfter.weightedProgress },
      ],
    });
  });

  return {
    items: await listWbs(projectId),
    weight: summary.activityWeight,
    removed: existing.filter((row) => !usedIds.has(row.id)).length,
  };
}

type TxLike = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function upsertCalendar(
  tx: TxLike,
  user: SessionUser,
  projectId: string,
  summary: ReturnType<typeof summarizeWeights>,
  input: SaveWbsInput,
) {
  const rows = await tx.select().from(projectWbsCalendars)
    .where(and(eq(projectWbsCalendars.projectId, projectId), eq(projectWbsCalendars.status, "DRAFT")))
    .limit(1);
  const values = {
    totalWeight: summary.activityWeight.toFixed(2),
    itemCount: summary.activityCount,
    weightedProgress: summary.weightedProgress.toFixed(2),
    startDate: input.startDate ?? null,
    note: input.note ?? null,
    updatedAt: new Date(),
  };
  if (rows.length) {
    await tx.update(projectWbsCalendars).set(values).where(eq(projectWbsCalendars.id, rows[0].id));
    return rows[0].id;
  }
  const [latest] = await tx.select({ version: projectWbsCalendars.version }).from(projectWbsCalendars)
    .where(eq(projectWbsCalendars.projectId, projectId)).orderBy(sql`version desc`).limit(1);
  const id = newId();
  await tx.insert(projectWbsCalendars).values({
    id, projectId, version: (latest?.version ?? 0) + 1, status: "DRAFT",
    totalWeight: summary.activityWeight.toFixed(2), itemCount: summary.activityCount,
    weightedProgress: summary.weightedProgress.toFixed(2),
    startDate: input.startDate ?? null, note: input.note ?? null, createdById: user.id,
  });
  return id;
}

export type WbsRow = {
  id: string; parentId: string | null; level: number; type: string; name: string; code: string | null;
  isSummary: boolean; weight: string; progressPct: string; status: string;
  plannedStart: string | null; plannedEnd: string | null;
  actualStart: string | null; actualEnd: string | null;
  ownerId: string | null; ownerName: string | null; sortOrder: number; committedAmount: string;
};

export async function listWbs(projectId: string): Promise<WbsRow[]> {
  const rows = await db.select().from(scheduleItems).where(eq(scheduleItems.projectId, projectId));
  const owners = await db.select({ id: users.id, name: users.name }).from(users);
  const ownerMap = new Map(owners.map((owner) => [owner.id, owner.name]));
  return rows
    .sort((a, b) => a.level - b.level || a.sortOrder - b.sortOrder)
    .map((row) => ({
      id: row.id, parentId: row.parentId, level: row.level, type: row.type, name: row.name,
      code: row.code, isSummary: row.isSummary, weight: row.weight ?? "0",
      progressPct: row.progressPct ?? "0", status: row.status,
      plannedStart: row.plannedStart, plannedEnd: row.plannedEnd,
      actualStart: row.actualStart, actualEnd: row.actualEnd,
      ownerId: row.ownerId, ownerName: row.ownerId ? ownerMap.get(row.ownerId) ?? null : null,
      sortOrder: row.sortOrder, committedAmount: row.committedAmount ?? "0",
    }));
}

/** Saran bobot merata untuk UI, tetap Σ 100. */
export function suggestWeights(items: { weight: string; isSummary: boolean }[]) {
  const activities = items.filter((item) => !item.isSummary);
  const even = activities.length ? Math.floor(10000 / activities.length) / 100 : 0;
  const weights = activities.map(() => even);
  const remainder = activities.length ? Math.round((100 - even * activities.length) * 100) / 100 : 0;
  if (weights.length) weights[weights.length - 1] = Math.round((weights[weights.length - 1] + remainder) * 100) / 100;
  return normalizeWeights(weights);
}

/** Kurva-S proyek: rencana dari tanggal WBS, aktual dari update progres. */
export async function getSCurve(user: SessionUser, projectId: string) {
  await requireProject(user, projectId, "schedule.view");
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) throw new ApiError("NOT_FOUND", "Proyek tidak ditemukan.", 404);
  const items = await db.select().from(scheduleItems).where(eq(scheduleItems.projectId, projectId));
  const [calendar] = await db.select().from(projectWbsCalendars)
    .where(eq(projectWbsCalendars.projectId, projectId)).orderBy(sql`version desc`).limit(1);
  const updates = await db.select({
    scheduleItemId: progressUpdates.scheduleItemId,
    reportDate: progressUpdates.reportDate,
    progressPct: progressUpdates.progressPct,
  }).from(progressUpdates).where(eq(progressUpdates.projectId, projectId));

  const starts = items.map((item) => item.plannedStart).filter((value): value is string => !!value);
  const ends = items.map((item) => item.plannedEnd).filter((value): value is string => !!value);
  const startDate = calendar?.startDate ?? (starts.length ? starts.sort()[0] : project.startDate)
    ?? todayJakarta();
  const endDate = project.targetEndDate
    ?? (ends.length ? ends.sort()[ends.length - 1] : startDate);

  const wbs = items.map(toWbs);
  const curve = buildSCurve({
    items: wbs,
    startDate,
    endDate,
    actualByPeriod: actualIncrementByPeriod(wbs, updates),
  });
  const summary = summarizeWeights(wbs);
  return {
    ...curve,
    projectCode: project.code,
    startDate,
    endDate,
    summary,
    calendar: calendar ? {
      id: calendar.id, version: calendar.version, status: calendar.status,
      totalWeight: calendar.totalWeight, lockedAt: calendar.lockedAt,
    } : null,
  } satisfies SCurve & Record<string, unknown>;
}

/** Kunci kalender WBS: setelah LOCK, simpan WBS hanya lewat revisi ADMIN. */
export async function lockWbsCalendar(user: SessionUser, projectId: string, reason: unknown) {
  await requireProject(user, projectId, "schedule.edit");
  if (!canEditWbs(user)) throw new ApiError("FORBIDDEN", "Izin schedule.edit diperlukan.", 403);
  const note = requiredReason(reason, "Alasan mengunci kalender WBS");
  const [calendar] = await db.select().from(projectWbsCalendars)
    .where(and(eq(projectWbsCalendars.projectId, projectId), eq(projectWbsCalendars.status, "DRAFT")))
    .limit(1);
  if (!calendar) throw new ApiError("WBS_CALENDAR_MISSING", "Belum ada kalender WBS DRAFT untuk dikunci.", 404);
  const items = await db.select().from(scheduleItems).where(eq(scheduleItems.projectId, projectId));
  const summary = summarizeWeights(items.map(toWbs));
  if (summary.activityCount && Math.abs(summary.activityWeight - 100) > WEIGHT_TOLERANCE) {
    throw new ApiError("WBS_WEIGHT_TOTAL", summary.warning ?? "Total bobot belum 100%.", 422);
  }
  await db.transaction(async (tx) => {
    await tx.update(projectWbsCalendars).set({
      status: "LOCKED", lockedAt: new Date(), lockedById: user.id,
      totalWeight: summary.activityWeight.toFixed(2), weightedProgress: summary.weightedProgress.toFixed(2),
      updatedAt: new Date(),
    }).where(eq(projectWbsCalendars.id, calendar.id));
    await tx.insert(activityLogs).values({
      id: newId(), actorId: user.id, objectType: "WBS_ITEM", objectId: projectId, projectId,
      action: "CALENDAR_LOCKED", reason: note,
      changes: [{ field: "status", old: "DRAFT", new: "LOCKED" }, { field: "version", old: null, new: calendar.version }],
    });
  });
  return { id: calendar.id, status: "LOCKED", version: calendar.version };
}

/** Salinan kalender untuk admin (audit & pembanding baseline). */
export async function listWbsCalendars(projectId: string) {
  const rows = await db.select().from(projectWbsCalendars)
    .where(eq(projectWbsCalendars.projectId, projectId)).orderBy(sql`version desc`);
  const owners = await db.select({ id: users.id, name: users.name }).from(users);
  const ownerMap = new Map(owners.map((owner) => [owner.id, owner.name]));
  return rows.map((row) => ({
    id: row.id, version: row.version, status: row.status, totalWeight: row.totalWeight,
    itemCount: row.itemCount, weightedProgress: row.weightedProgress, startDate: row.startDate,
    note: row.note, lockedAt: row.lockedAt,
    lockedByName: row.lockedById ? ownerMap.get(row.lockedById) ?? null : null,
    createdByName: row.createdById ? ownerMap.get(row.createdById) ?? null : null,
    updatedAt: row.updatedAt,
  }));
}

/** Tautan RAB → WBS (hook B7): pos RAB bisa dihubungkan ke item WBS. */
export async function linkBudgetLineToWbs(user: SessionUser, projectId: string, budgetLineId: string, wbsItemId: string | null) {
  await requireProject(user, projectId, "budget.edit");
  if (!hasPermission(user, "budget.edit")) throw new ApiError("FORBIDDEN", "Izin budget.edit diperlukan.", 403);
  const [item] = wbsItemId
    ? await db.select().from(scheduleItems).where(and(eq(scheduleItems.id, wbsItemId), eq(scheduleItems.projectId, projectId))).limit(1)
    : [];
  if (wbsItemId && !item) throw new ApiError("WBS_ITEM_NOT_FOUND", "Item WBS tidak ditemukan pada proyek ini.", 404);
  const [line] = await db.update(budgetLines).set({ wbsItemId }).where(eq(budgetLines.id, budgetLineId)).returning({ id: budgetLines.id });
  if (!line) throw new ApiError("NOT_FOUND", "Pos RAB tidak ditemukan.", 404);
  await db.insert(activityLogs).values({
    id: newId(), actorId: user.id, objectType: "BUDGET_LINE", objectId: budgetLineId, projectId,
    action: "WBS_LINKED", changes: [{ field: "wbsItemId", old: null, new: wbsItemId }],
  });
  return { id: budgetLineId, wbsItemId };
}

/** Ringkasan WBS yang dipakai kartu dashboard (tanpa query kurva penuh). */
export async function wbsOverview(user: SessionUser, projectIds: string[]) {
  if (!projectIds.length) return [];
  const items = await db.select().from(scheduleItems).where(inArray(scheduleItems.projectId, projectIds));
  return projectIds.map((projectId) => {
    const rows = items.filter((item) => item.projectId === projectId);
    const summary = summarizeWeights(rows.map(toWbs));
    return {
      projectId, itemCount: rows.length, activityCount: summary.activityCount,
      totalWeight: summary.activityWeight, weightedProgress: summary.weightedProgress,
      weightOk: Math.abs(summary.activityWeight - 100) <= WEIGHT_TOLERANCE,
      plannedEnd: rows.map((row) => row.plannedEnd).filter(Boolean).sort().at(-1) ?? null,
      syncedAt: formatDate(new Date()),
    };
  });
}

/** Dipakai dokumentasi generator: baris jadwal untuk template PROGRESS_REPORT. */
export async function scheduleDocumentRows(projectId: string) {
  const rows = await db.select().from(scheduleItems)
    .where(eq(scheduleItems.projectId, projectId))
    .orderBy(asc(scheduleItems.level), asc(scheduleItems.sortOrder));
  return rows.map((row) => ({
    activity: `${"  ".repeat(Math.max(0, row.level - 1))}${row.name}`,
    plan: row.plannedEnd ? formatDate(row.plannedEnd) : "—",
    progress: `${row.progressPct ?? 0}%`,
    status: row.status,
  }));
}

// Ekspor untuk tes integrasi komponen tanpa DB.
export { summarizeWeights };
