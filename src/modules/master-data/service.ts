import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  activityLogs, budgetLines, clients, companySettings, contractTerms, costCategories, customerInvoices,
  expenseLines, memberships, projectMembers, projects, sites, units, users,
} from "@/db/schema";
import { ApiError, hasPermission } from "@/lib/auth";
import type { Permission, SessionUser } from "@/lib/domain";
import { todayJakarta } from "@/lib/format";
import { D, money } from "@/lib/format";
import { newId, requiredReason, requireProject } from "@/lib/server-services";
import {
  assertSingleRetention, buildClientCode, buildProjectCode, CLIENT_CODE_PATTERN, INITIAL_STAGE,
  maxSequence, PROJECT_SEQ_PATTERN, summarizeTermComposition,
} from "@/modules/master-data/types";
import type {
  ClientInput, ContractTermInput, CostCategoryInput, ProjectInput, ProjectMemberInput,
  ProjectUpdateInput, SiteInput, UnitInput,
} from "@/modules/master-data/validation";

/* Semua fungsi berjalan DI DALAM withCompany(): `db` = transaksi berskope
 * company (RLS aktif), jadi satu request = satu transaksi = atomic. */

const PROJECT_EDIT: Permission = "schedule.edit";

function assertCanEdit(user: SessionUser, permission: Permission = PROJECT_EDIT) {
  if (!hasPermission(user, permission)) {
    throw new ApiError("FORBIDDEN", `Izin ${permission} diperlukan untuk mengubah master data proyek.`, 403);
  }
}

async function log(input: {
  actorId: string; objectType: string; objectId: string; projectId?: string | null;
  action: string; changes?: { field: string; old: unknown; new: unknown }[]; reason?: string | null;
}) {
  await db.insert(activityLogs).values({
    id: newId(), actorId: input.actorId, objectType: input.objectType, objectId: input.objectId,
    projectId: input.projectId ?? null, action: input.action, changes: input.changes ?? null,
    reason: input.reason ?? null,
  });
}

/* -------------------------------------------------------------------------- */
/* Opsi form (wizard proyek)                                                   */
/* -------------------------------------------------------------------------- */

export async function getMasterDataOptions(user: SessionUser) {
  // Non-ADMIN hanya melihat anggota aktif company (RLS sudah membatasi per company).
  const [memberRows, clientRows, siteRows] = await Promise.all([
    db.select({ id: users.id, name: users.name, email: users.email, title: users.title, role: memberships.companyRole })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.status, "ACTIVE")),
    db.select({ id: clients.id, code: clients.code, displayName: clients.displayName, legalName: clients.legalName })
      .from(clients).where(sql`${clients.deletedAt} IS NULL`),
    db.select({ id: sites.id, clientId: sites.clientId, name: sites.name, address: sites.address })
      .from(sites),
  ]);
  // PM butuh daftar anggota untuk memilih tim; email hanya untuk ADMIN/FINANCE.
  const canSeeAll = user.companyRole === "ADMIN" || hasPermission(user, "users.manage");
  const userOptions = memberRows
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((m) => (canSeeAll ? m : { id: m.id, name: m.name, title: m.title, role: m.role }));
  return {
    users: userOptions,
    clients: clientRows.sort((a, b) => a.displayName.localeCompare(b.displayName)),
    sites: siteRows.sort((a, b) => a.name.localeCompare(b.name)),
    projectRoles: [...PROJECT_ROLE_RUNTIME],
    meta: { defaultPpnRate: await defaultPpnRate(), today: todayJakarta() },
  };
}

/** Dipakai UI & validasi; sengaja runtime-array supaya tipenya tidak jadi literal union dobel. */
const PROJECT_ROLE_RUNTIME = ["ADMIN", "ESTIMATOR", "PM", "FIELD", "PROCUREMENT", "FINANCE", "CLIENT_VIEWER"] as const;

async function defaultPpnRate() {
  const [settings] = await db.select({ rate: companySettings.defaultPpnRate }).from(companySettings).limit(1);
  return settings?.rate ?? "11";
}

/* -------------------------------------------------------------------------- */
/* Klien                                                                      */
/* -------------------------------------------------------------------------- */

async function nextSequence(table: "clients" | "projects", pattern: RegExp, year?: number) {
  // Advisory lock per tabel (bukan per row) agar dua request paralel tidak
  // menghasilkan kode yang sama sebelum index unik menolak.
  await db.execute(sql`select pg_advisory_xact_lock(${table === "clients" ? 773001 : 773002})`);
  if (table === "clients") {
    const rows = await db.select({ code: clients.code }).from(clients);
    return maxSequence(rows.map((r) => r.code), pattern) + 1;
  }
  const rows = await db.select({ code: projects.code }).from(projects);
  return maxSequence(rows.map((r) => r.code), pattern) + 1;
}

async function assertClientExists(clientId: string) {
  const [client] = await db.select({ id: clients.id, deletedAt: clients.deletedAt })
    .from(clients).where(eq(clients.id, clientId)).limit(1);
  if (!client) throw new ApiError("CLIENT_NOT_FOUND", "Klien tidak ditemukan pada company ini.", 404);
  if (client.deletedAt) throw new ApiError("CLIENT_ARCHIVED", "Klien sudah diarsipkan.", 409);
  return client;
}

export async function createClient(user: SessionUser, input: ClientInput) {
  assertCanEdit(user);
  const sequence = input.code ? 0 : await nextSequence("clients", CLIENT_CODE_PATTERN);
  const code = input.code ?? buildClientCode(sequence);
  const [duplicate] = await db.select({ id: clients.id }).from(clients).where(eq(clients.code, code)).limit(1);
  if (duplicate) throw new ApiError("DUPLICATE_CODE", `Kode klien ${code} sudah dipakai.`, 409);
  const id = newId();
  await db.insert(clients).values({
    id, code, legalName: input.legalName.trim(), displayName: input.displayName.trim(),
    industry: input.industry.trim(), npwp: input.npwp ?? null, address: input.address ?? null,
    contactName: input.contactName ?? null, contactPhone: input.contactPhone ?? null,
  });
  await log({
    actorId: user.id, objectType: "CLIENT", objectId: id, action: "CREATED",
    changes: [{ field: "code", old: null, new: code }, { field: "displayName", old: null, new: input.displayName }],
  });
  return { id, code };
}

export async function updateClient(user: SessionUser, clientId: string, input: ClientInput) {
  assertCanEdit(user);
  const [existing] = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1);
  if (!existing) throw new ApiError("CLIENT_NOT_FOUND", "Klien tidak ditemukan pada company ini.", 404);
  const changes: { field: string; old: unknown; new: unknown }[] = [];
  const next = {
    legalName: input.legalName.trim(), displayName: input.displayName.trim(), industry: input.industry.trim(),
    npwp: input.npwp ?? null, address: input.address ?? null,
    contactName: input.contactName ?? null, contactPhone: input.contactPhone ?? null,
  };
  for (const [field, value] of Object.entries(next)) {
    const old = (existing as Record<string, unknown>)[field];
    if (String(old ?? "") !== String(value ?? "")) changes.push({ field, old: old ?? null, new: value });
  }
  if (!changes.length) return { id: clientId, changed: 0 };
  await db.update(clients).set(next).where(eq(clients.id, clientId));
  await log({ actorId: user.id, objectType: "CLIENT", objectId: clientId, action: "UPDATED", changes });
  return { id: clientId, changed: changes.length };
}

export async function archiveClient(user: SessionUser, clientId: string) {
  assertCanEdit(user);
  const [existing] = await db.select({ id: clients.id, deletedAt: clients.deletedAt })
    .from(clients).where(eq(clients.id, clientId)).limit(1);
  if (!existing) throw new ApiError("CLIENT_NOT_FOUND", "Klien tidak ditemukan pada company ini.", 404);
  const activeProjects = await db.select({ id: projects.id }).from(projects).where(eq(projects.clientId, clientId));
  if (activeProjects.length) {
    throw new ApiError(
      "CLIENT_HAS_PROJECTS",
      `Klien tidak dapat diarsipkan: masih memiliki ${activeProjects.length} proyek.`,
      409,
    );
  }
  await db.update(clients).set({ deletedAt: new Date() }).where(eq(clients.id, clientId));
  await log({ actorId: user.id, objectType: "CLIENT", objectId: clientId, action: "ARCHIVED" });
  return { id: clientId };
}

/* -------------------------------------------------------------------------- */
/* Site                                                                       */
/* -------------------------------------------------------------------------- */

export async function createSite(user: SessionUser, input: SiteInput) {
  assertCanEdit(user);
  await assertClientExists(input.clientId);
  const id = newId();
  await db.insert(sites).values({
    id, clientId: input.clientId, name: input.name.trim(), address: input.address ?? null,
    contact: input.contact ?? null, latitude: input.latitude || null, longitude: input.longitude || null,
  });
  await log({
    actorId: user.id, objectType: "SITE", objectId: id, action: "CREATED",
    changes: [{ field: "name", old: null, new: input.name }, { field: "clientId", old: null, new: input.clientId }],
  });
  return { id };
}

export async function updateSite(user: SessionUser, siteId: string, input: SiteInput) {
  assertCanEdit(user);
  const [existing] = await db.select().from(sites).where(eq(sites.id, siteId)).limit(1);
  if (!existing) throw new ApiError("SITE_NOT_FOUND", "Site tidak ditemukan pada company ini.", 404);
  await assertClientExists(input.clientId);
  const next = {
    clientId: input.clientId, name: input.name.trim(), address: input.address ?? null,
    contact: input.contact ?? null, latitude: input.latitude || null, longitude: input.longitude || null,
  };
  const changes: { field: string; old: unknown; new: unknown }[] = [];
  for (const [field, value] of Object.entries(next)) {
    const old = (existing as Record<string, unknown>)[field];
    if (String(old ?? "") !== String(value ?? "")) changes.push({ field, old: old ?? null, new: value });
  }
  if (!changes.length) return { id: siteId, changed: 0 };
  await db.update(sites).set(next).where(eq(sites.id, siteId));
  await log({ actorId: user.id, objectType: "SITE", objectId: siteId, action: "UPDATED", changes });
  return { id: siteId, changed: changes.length };
}

/* -------------------------------------------------------------------------- */
/* Proyek                                                                     */
/* -------------------------------------------------------------------------- */

export async function createProject(user: SessionUser, input: ProjectInput) {
  assertCanEdit(user);
  await assertClientExists(input.clientId);
  if (input.siteId) {
    const [site] = await db.select({ id: sites.id, clientId: sites.clientId }).from(sites).where(eq(sites.id, input.siteId)).limit(1);
    if (!site) throw new ApiError("SITE_NOT_FOUND", "Site tidak ditemukan pada company ini.", 404);
    if (site.clientId !== input.clientId) throw new ApiError("SITE_CLIENT_MISMATCH", "Site bukan milik klien yang dipilih.", 422);
  }
  if (input.pmId) await assertAssignableUser(input.pmId, user);

  const code = input.code ?? buildProjectCode(Number(todayJakarta().slice(0, 4)), await nextSequence("projects", PROJECT_SEQ_PATTERN));
  const [duplicate] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, code)).limit(1);
  if (duplicate) throw new ApiError("DUPLICATE_CODE", `Kode proyek ${code} sudah dipakai.`, 409);

  const id = newId();
  await db.insert(projects).values({
    id, code, title: input.title.trim(), clientId: input.clientId, siteId: input.siteId || null,
    pmId: input.pmId || null, stage: INITIAL_STAGE, contractNumber: input.contractNumber ?? null,
    contractDate: input.contractDate || null, contractValue: input.contractValue ?? "0",
    retentionPct: input.retentionPct ?? "5", warrantyMonths: input.warrantyMonths ?? 12,
    startDate: input.startDate || null, targetEndDate: input.targetEndDate || null,
  });

  // PM otomatis menjadi anggota agar requireProject() (S1) tidak menolak aksesnya.
  const members = [...(input.members ?? [])];
  if (input.pmId && !members.some((m) => m.userId === input.pmId)) members.unshift({ userId: input.pmId, projectRole: "PM" });
  // Pembuat proyek (non-ADMIN) juga diberi akses; ADMIN tidak butuh baris anggota.
  if (user.companyRole !== "ADMIN" && !members.some((m) => m.userId === user.id)) {
    members.push({ userId: user.id, projectRole: user.companyRole });
  }
  const created = await insertMembers(id, members, user);
  await log({
    actorId: user.id, objectType: "PROJECT", objectId: id, projectId: id, action: "CREATED",
    changes: [
      { field: "code", old: null, new: code },
      { field: "title", old: null, new: input.title },
      { field: "contractValue", old: null, new: input.contractValue ?? "0" },
      { field: "members", old: null, new: created.map((m) => `${m.userId}:${m.projectRole}`) },
    ],
  });
  return { id, code, stage: INITIAL_STAGE, members: created.length };
}

async function assertAssignableUser(userId: string, actor: SessionUser) {
  const [row] = await db.select({ id: users.id, role: memberships.companyRole, status: memberships.status })
    .from(users).innerJoin(memberships, eq(memberships.userId, users.id))
    .where(and(eq(users.id, userId), eq(memberships.companyId, actor.companyId))).limit(1);
  if (!row) throw new ApiError("USER_NOT_IN_COMPANY", "Pengguna bukan anggota aktif company ini.", 422);
  if (row.status !== "ACTIVE") throw new ApiError("USER_INACTIVE", "Pengguna tidak aktif.", 422);
  return row;
}

async function insertMembers(projectId: string, members: ProjectMemberInput[], user: SessionUser) {
  const unique = new Map<string, ProjectMemberInput>();
  for (const member of members) unique.set(`${member.userId}:${member.projectRole}`, member);
  const rows: { id: string; projectId: string; userId: string; projectRole: string }[] = [];
  for (const member of unique.values()) {
    await assertAssignableUser(member.userId, user);
    rows.push({ id: newId(), projectId, userId: member.userId, projectRole: member.projectRole });
  }
  if (!rows.length) return rows;
  await db.insert(projectMembers).values(rows);
  return rows;
}

export async function updateProject(user: SessionUser, projectId: string, input: ProjectUpdateInput) {
  const [existing] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!existing) throw new ApiError("NOT_FOUND", "Proyek tidak ditemukan.", 404);
  if (existing.isLocked && user.companyRole !== "ADMIN") {
    throw new ApiError("PROJECT_LOCKED", "Proyek COMPLETED terkunci. Hanya ADMIN yang dapat mengubah.", 409);
  }
  if (input.siteId) {
    const [site] = await db.select({ id: sites.id, clientId: sites.clientId }).from(sites).where(eq(sites.id, input.siteId)).limit(1);
    if (!site) throw new ApiError("SITE_NOT_FOUND", "Site tidak ditemukan pada company ini.", 404);
    if (site.clientId !== existing.clientId) throw new ApiError("SITE_CLIENT_MISMATCH", "Site bukan milik klien proyek ini.", 422);
  }
  if (input.pmId) await assertAssignableUser(input.pmId, user);

  const next: Record<string, unknown> = {};
  const changes: { field: string; old: unknown; new: unknown }[] = [];
  const map: Record<string, unknown> = {
    title: input.title?.trim(), siteId: input.siteId || null, pmId: input.pmId || null,
    contractNumber: input.contractNumber ?? null, contractDate: input.contractDate || null,
    contractValue: input.contractValue, retentionPct: input.retentionPct,
    warrantyMonths: input.warrantyMonths, startDate: input.startDate || null, targetEndDate: input.targetEndDate || null,
  };
  for (const [field, value] of Object.entries(map)) {
    if (value === undefined) continue;
    const old = (existing as Record<string, unknown>)[field];
    if (String(old ?? "") === String(value ?? "")) continue;
    next[field] = value;
    changes.push({ field, old: old ?? null, new: value });
  }
  if (!changes.length) return { id: projectId, changed: 0 };
  next.updatedAt = new Date();
  // contract_value diubah lewat update ini → trigger 0002 menyegarkan contract_value_current.
  await db.update(projects).set(next).where(eq(projects.id, projectId));
  if (input.pmId) await insertMembers(projectId, [{ userId: input.pmId, projectRole: "PM" }], user).catch(() => []);
  await log({ actorId: user.id, objectType: "PROJECT", objectId: projectId, projectId, action: "UPDATED", changes });
  return { id: projectId, changed: changes.length };
}

export async function addProjectMember(user: SessionUser, projectId: string, input: ProjectMemberInput) {
  const [project] = await db.select({ id: projects.id, isLocked: projects.isLocked }).from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) throw new ApiError("NOT_FOUND", "Proyek tidak ditemukan.", 404);
  assertCanEdit(user);
  const [existing] = await db.select({ id: projectMembers.id }).from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, input.userId))).limit(1);
  if (existing) throw new ApiError("MEMBER_EXISTS", "Pengguna sudah menjadi anggota proyek ini.", 409);
  const rows = await insertMembers(projectId, [input], user);
  await log({
    actorId: user.id, objectType: "PROJECT_MEMBER", objectId: rows[0].id, projectId, action: "CREATED",
    changes: [{ field: "userId", old: null, new: input.userId }, { field: "projectRole", old: null, new: input.projectRole }],
  });
  return { id: rows[0].id };
}

export async function removeProjectMember(user: SessionUser, projectId: string, memberId: string) {
  const [member] = await db.select().from(projectMembers)
    .where(and(eq(projectMembers.id, memberId), eq(projectMembers.projectId, projectId))).limit(1);
  if (!member) throw new ApiError("NOT_FOUND", "Anggota proyek tidak ditemukan.", 404);
  assertCanEdit(user);
  const [project] = await db.select({ pmId: projects.pmId }).from(projects).where(eq(projects.id, projectId)).limit(1);
  if (project?.pmId && project.pmId === member.userId) {
    throw new ApiError("MEMBER_IS_PM", "PM proyek tidak dapat dikeluarkan. Ganti PM terlebih dahulu.", 409);
  }
  // Jangan sampai anggota non-ADMIN terakhir dikeluarkan: proyek menjadi tak terlihat
  // bagi semua peran lapangan/PM (ADMIN selalu bisa mengakses).
  const remaining = await db.select({ userId: projectMembers.userId, id: projectMembers.id }).from(projectMembers).where(eq(projectMembers.projectId, projectId));
  if (remaining.length <= 1) {
    throw new ApiError("MEMBER_LAST", "Minimal satu anggota proyek harus tersisa (ADMIN tidak memerlukan baris anggota).", 409);
  }
  await db.delete(projectMembers).where(eq(projectMembers.id, memberId));
  await log({
    actorId: user.id, objectType: "PROJECT_MEMBER", objectId: memberId, projectId, action: "DELETED",
    changes: [{ field: "userId", old: member.userId, new: null }, { field: "projectRole", old: member.projectRole, new: null }],
  });
  return { id: memberId };
}

/** Daftar anggota semua proyek pada company (dipakai layar Master Data). */
export async function listProjectMembers(projectIds: string[]) {
  if (!projectIds.length) return [];
  return db.select({
    id: projectMembers.id, projectId: projectMembers.projectId, userId: projectMembers.userId,
    projectRole: projectMembers.projectRole, name: users.name, email: users.email, title: users.title,
  }).from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .where(inArray(projectMembers.projectId, projectIds));
}

/* -------------------------------------------------------------------------- */
/* Tahap 3 · termin kontrak                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Menyimpan daftar termin proyek secara menyeluruh (replace-by-set).
 *
 * Alasan replace, bukan CRUD per baris: komposisi termin adalah SATU kesatuan
 * (persen harus berjumlah 100%), sehingga validasi dan penulisan harus atomik.
 * Baris yang sudah punya tagihan (`invoiced_amount > 0`) TIDAK dihapus — bila
 * dihapus, invoice lama akan kehilangan terminnya dan kumulatif tagihan salah.
 */
/**
 * Termin adalah komitmen komersial: dimiliki tim invoice (`invoice.edit`,
 * FINANCE/ADMIN) atau pihak yang menyetujui RAB klien (`budget.approve`, PM/ADMIN).
 * Keduanya tetap wajib menjadi anggota proyek lewat `requireProject()`.
 */
function canManageTerms(user: SessionUser) {
  return hasPermission(user, "invoice.edit") || hasPermission(user, "budget.approve");
}

export async function saveContractTerms(user: SessionUser, projectId: string, terms: ContractTermInput[]) {
  await requireProject(user, projectId);
  if (!canManageTerms(user)) {
    throw new ApiError("FORBIDDEN", "Izin invoice.edit atau budget.approve diperlukan untuk mengubah termin.", 403);
  }
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) throw new ApiError("NOT_FOUND", "Proyek tidak ditemukan.", 404);
  if (project.isLocked && user.companyRole !== "ADMIN") {
    throw new ApiError("PROJECT_LOCKED", "Proyek COMPLETED terkunci. Hanya ADMIN yang dapat mengubah termin.", 409);
  }

  const retentionError = assertSingleRetention(terms);
  if (retentionError) throw new ApiError("RETENTION_DUPLICATE", retentionError, 422);
  const composition = summarizeTermComposition(terms.map((t) => ({ percent: t.percent ?? null, type: t.type })));
  if (composition.warning) {
    throw new ApiError("TERM_PERCENT_TOTAL", composition.warning, 422, composition);
  }

  const existing = await db.select().from(contractTerms).where(eq(contractTerms.projectId, projectId));
  const invoicedIds = new Set(existing.filter((t) => D(t.invoicedAmount ?? 0).gt(0)).map((t) => t.id));
  const incomingIds = new Set(terms.map((t) => t.id).filter((id): id is string => !!id));

  // Termin yang sudah ditagihkan tidak boleh hilang dari daftar.
  const detached = [...invoicedIds].filter((id) => !incomingIds.has(id));
  if (detached.length) {
    throw new ApiError(
      "TERM_HAS_INVOICES",
      `${detached.length} termin sudah memiliki tagihan dan tidak boleh dihapus. Tandai CLOSED atau pertahankan barisnya.`,
      409,
      { termIds: detached },
    );
  }

  // `contract_terms_project_sort_idx` unik per (company, project, sort_order),
  // jadi penyimpanan replace-by-set harus lewat slot sementara: geser semua baris
  // lama ke luar rentang (maks 40 termin), lalu tulis urutan final. Semua di dalam
  // satu transaksi, sehingga aman saat urutan ditukar atau baris dihapus.
  if (existing.length) {
    await db.update(contractTerms)
      .set({ sortOrder: sql`${contractTerms.sortOrder} + 1000` })
      .where(eq(contractTerms.projectId, projectId));
  }

  const contractValue = D(project.contractValueCurrent ?? project.contractValue ?? 0);
  const changes: { field: string; old: unknown; new: unknown }[] = [];
  const seen = new Set<string>();
  for (const [index, term] of terms.entries()) {
    const percent = term.percent ?? null;
    const autoAmount = percent !== null;
    const amount = autoAmount
      ? percentToAmount(contractValue, percent)
      : money(term.amount ?? "0");
    const invoiceSum = existing.find((t) => t.id === term.id)?.invoicedAmount ?? "0";
    if (autoAmount && D(amount).lt(D(invoiceSum))) {
      throw new ApiError(
        "TERM_BELOW_INVOICED",
        `Termin "${term.name}": nilai baru ${money(amount)} lebih kecil dari tagihan yang sudah ada ${money(invoiceSum)}.`,
        422,
      );
    }
    const row = {
      projectId, type: term.type, name: term.name.trim(), percent: percent ?? null,
      amount, trigger: term.trigger ?? null, targetDate: term.targetDate || null,
      sortOrder: index, notes: term.notes ?? null, isAutoAmount: autoAmount,
    };
    if (term.id && existing.some((t) => t.id === term.id)) {
      const old = existing.find((t) => t.id === term.id)!;
      await db.update(contractTerms).set(row).where(eq(contractTerms.id, term.id));
      if (old.amount !== row.amount || old.name !== row.name || old.percent !== row.percent) {
        changes.push({ field: `term:${old.name}`, old: { amount: old.amount, percent: old.percent }, new: { amount: row.amount, percent: row.percent } });
      }
      seen.add(term.id);
    } else {
      const id = newId();
      await db.insert(contractTerms).values({ id, ...row });
      changes.push({ field: `term:${row.name}`, old: null, new: { amount: row.amount, percent: row.percent, type: row.type } });
      seen.add(id);
    }
  }

  // Hapus hanya termin tanpa tagihan yang memang tidak dikirim lagi.
  const removals = existing.filter((t) => !seen.has(t.id) && !invoicedIds.has(t.id));
  for (const removal of removals) {
    await db.delete(contractTerms).where(eq(contractTerms.id, removal.id));
    changes.push({ field: `term:${removal.name}`, old: { amount: removal.amount }, new: null });
  }

  await log({
    actorId: user.id, objectType: "CONTRACT_TERM", objectId: projectId, projectId, action: "TERMS_SAVED",
    changes, reason: `Total persen ${composition.totalPercent.toFixed(2)}%`,
  });
  return {
    count: terms.length, removed: removals.length, changed: changes.length,
    totalPercent: composition.totalPercent,
  };
}

function percentToAmount(contractValue: ReturnType<typeof D>, percent: string) {
  return money(contractValue.times(D(percent)).div(100));
}

export async function closeContractTerm(user: SessionUser, projectId: string, termId: string, reason: string) {
  await requireProject(user, projectId);
  if (!canManageTerms(user)) {
    throw new ApiError("FORBIDDEN", "Izin invoice.edit atau budget.approve diperlukan untuk menutup termin.", 403);
  }
  const [term] = await db.select().from(contractTerms)
    .where(and(eq(contractTerms.id, termId), eq(contractTerms.projectId, projectId))).limit(1);
  if (!term) throw new ApiError("NOT_FOUND", "Termin tidak ditemukan pada proyek ini.", 404);
  if (term.status === "CLOSED") return { id: termId, status: "CLOSED", changed: false };
  requiredReason(reason, "Alasan penutupan termin");
  await db.update(contractTerms).set({ status: "CLOSED" }).where(eq(contractTerms.id, termId));
  await log({
    actorId: user.id, objectType: "CONTRACT_TERM", objectId: termId, projectId, action: "CLOSED", reason,
    changes: [{ field: "status", old: term.status, new: "CLOSED" }],
  });
  return { id: termId, status: "CLOSED", changed: true };
}

/** Ringkasan termin untuk UI: butuh izin klien (invoice.view) agar tidak bocor ke FIELD. */
export async function listContractTerms(user: SessionUser, projectId: string) {
  await requireProject(user, projectId);
  const terms = await db.select().from(contractTerms).where(eq(contractTerms.projectId, projectId));
  const invoices = await db.select({
    id: customerInvoices.id, contractTermId: customerInvoices.contractTermId,
    totalAmount: customerInvoices.totalAmount, status: customerInvoices.status,
  }).from(customerInvoices).where(eq(customerInvoices.projectId, projectId));
  return terms
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((term) => ({
      ...term,
      invoiceCount: invoices.filter((i) => i.contractTermId === term.id && i.status !== "CANCELLED").length,
    }));
}

/* -------------------------------------------------------------------------- */
/* Tahap 3 · katalog kategori biaya & satuan                                  */
/* -------------------------------------------------------------------------- */

/**
 * Katalog bersifat GLOBAL + per company:
 *  - baris `company_id IS NULL` = katalog bersama (warisan pra-S1) → read-only di UI.
 *  - baris milik company aktif → boleh diubah selama belum dipakai transaksi.
 */
function assertCatalogManage(user: SessionUser) {
  // Mengubah katalog berdampak ke seluruh modul biaya, jadi hanya pengelola
  // pengaturan & budget internal (ADMIN/FINANCE) yang boleh menulis.
  if (!hasPermission(user, "settings.manage") && !hasPermission(user, "budget.edit")) {
    throw new ApiError("FORBIDDEN", "Izin settings.manage atau budget.edit diperlukan untuk mengubah katalog biaya.", 403);
  }
}

/**
 * `cost_categories`/`units` sengaja TANPA RLS (lihat 0001), jadi filter company
 * harus eksplisit: baris bersama (company_id NULL) + baris milik company aktif.
 */
export async function listCatalog(user: SessionUser) {
  const visibleCategory = or(isNull(costCategories.companyId), eq(costCategories.companyId, user.companyId));
  const visibleUnit = or(isNull(units.companyId), eq(units.companyId, user.companyId));
  const [categories, unitRows] = await Promise.all([
    db.select().from(costCategories).where(visibleCategory),
    db.select().from(units).where(visibleUnit),
  ]);
  const usedCategoryIds = new Set(
    (await db.select({ id: budgetLines.costCategoryId }).from(budgetLines)).map((r) => r.id),
  );
  const usedUnitCodes = new Set([
    ...(await db.select({ code: budgetLines.unitCode }).from(budgetLines)).map((r) => r.code),
    ...(await db.select({ code: expenseLines.unitCode }).from(expenseLines)).map((r) => r.code),
  ]);
  return {
    categories: categories
      .sort((a, b) => Number(a.companyId === null) - Number(b.companyId === null) || a.code.localeCompare(b.code))
      .map((c) => ({ ...c, shared: c.companyId === null, used: usedCategoryIds.has(c.id) })),
    units: unitRows
      .sort((a, b) => Number(a.companyId === null) - Number(b.companyId === null) || a.code.localeCompare(b.code))
      .map((u) => ({ ...u, shared: u.companyId === null, used: usedUnitCodes.has(u.code) })),
  };
}

export async function createCostCategory(user: SessionUser, input: CostCategoryInput) {
  assertCatalogManage(user);
  const [duplicate] = await db.select({ id: costCategories.id }).from(costCategories)
    .where(and(eq(costCategories.code, input.code), eq(costCategories.companyId, user.companyId))).limit(1);
  if (duplicate) throw new ApiError("DUPLICATE_CODE", `Kode kategori ${input.code} sudah dipakai company ini.`, 409);
  const id = newId();
  await db.insert(costCategories).values({
    id, companyId: user.companyId, code: input.code, name: input.name.trim(),
    isOverhead: input.isOverhead ?? false, isActive: input.isActive ?? true, createdById: user.id,
  });
  await log({
    actorId: user.id, objectType: "COST_CATEGORY", objectId: id, action: "CREATED",
    changes: [{ field: "code", old: null, new: input.code }, { field: "name", old: null, new: input.name }],
  });
  return { id, code: input.code };
}

export async function updateCostCategory(user: SessionUser, id: string, input: CostCategoryInput) {
  assertCatalogManage(user);
  const [existing] = await db.select().from(costCategories).where(eq(costCategories.id, id)).limit(1);
  if (!existing) throw new ApiError("NOT_FOUND", "Kategori tidak ditemukan.", 404);
  if (existing.companyId === null) throw new ApiError("SHARED_CATALOG_READONLY", "Katalog bersama tidak dapat diubah. Buat kategori company sendiri.", 409);
  if (existing.companyId !== user.companyId) throw new ApiError("NOT_FOUND", "Kategori tidak ditemukan pada company ini.", 404);
  if (input.code !== existing.code) {
    const used = await db.select({ id: budgetLines.id }).from(budgetLines).where(eq(budgetLines.costCategoryId, id)).limit(1);
    if (used.length) throw new ApiError("CATEGORY_IN_USE", "Kode kategori tidak dapat diubah karena sudah dipakai pos RAB.", 409);
  }
  const next = { code: input.code, name: input.name.trim(), isOverhead: input.isOverhead ?? existing.isOverhead, isActive: input.isActive ?? existing.isActive };
  await db.update(costCategories).set(next).where(eq(costCategories.id, id));
  await log({
    actorId: user.id, objectType: "COST_CATEGORY", objectId: id, action: "UPDATED",
    changes: Object.entries(next).filter(([field, value]) => String((existing as Record<string, unknown>)[field]) !== String(value))
      .map(([field, value]) => ({ field, old: (existing as Record<string, unknown>)[field], new: value })),
  });
  return { id };
}

export async function createUnit(user: SessionUser, input: UnitInput) {
  assertCatalogManage(user);
  const [duplicate] = await db.select({ id: units.id }).from(units)
    .where(and(eq(units.code, input.code), eq(units.companyId, user.companyId))).limit(1);
  if (duplicate) throw new ApiError("DUPLICATE_CODE", `Satuan ${input.code} sudah dipakai company ini.`, 409);
  const id = newId();
  await db.insert(units).values({ id, companyId: user.companyId, code: input.code, name: input.name.trim(), createdById: user.id });
  await log({
    actorId: user.id, objectType: "UNIT", objectId: id, action: "CREATED",
    changes: [{ field: "code", old: null, new: input.code }, { field: "name", old: null, new: input.name }],
  });
  return { id, code: input.code };
}

export async function updateUnit(user: SessionUser, id: string, input: UnitInput) {
  assertCatalogManage(user);
  const [existing] = await db.select().from(units).where(eq(units.id, id)).limit(1);
  if (!existing) throw new ApiError("NOT_FOUND", "Satuan tidak ditemukan.", 404);
  if (existing.companyId === null) throw new ApiError("SHARED_CATALOG_READONLY", "Katalog bersama tidak dapat diubah. Buat satuan company sendiri.", 409);
  if (existing.companyId !== user.companyId) throw new ApiError("NOT_FOUND", "Satuan tidak ditemukan pada company ini.", 404);
  if (input.code !== existing.code) throw new ApiError("CODE_IMMUTABLE", "Kode satuan tidak dapat diubah karena dipakai pada pos/nota lama.", 409);
  await db.update(units).set({ name: input.name.trim() }).where(eq(units.id, id));
  await log({
    actorId: user.id, objectType: "UNIT", objectId: id, action: "UPDATED",
    changes: [{ field: "name", old: existing.name, new: input.name }],
  });
  return { id };
}
