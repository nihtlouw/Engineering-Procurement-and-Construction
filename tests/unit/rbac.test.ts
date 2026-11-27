import { describe, expect, it } from "vitest";
import { PERMISSIONS, ROLES, ROLE_PERMISSIONS, type Permission, type Role } from "@/lib/domain";
import { assertExportAllowed, visibleBudgetTypes } from "@/lib/export-permissions";

const has = (role: keyof typeof ROLE_PERMISSIONS, permission: Permission) =>
  ROLE_PERMISSIONS[role].includes(permission);

describe("matriks peran & permission", () => {
  it("mendefinisikan permission untuk seluruh role", () => {
    for (const role of ROLES) expect(ROLE_PERMISSIONS[role]).toBeDefined();
  });

  it("setiap permission yang dipakai role terdaftar dalam PERMISSIONS", () => {
    for (const role of ROLES) {
      for (const permission of ROLE_PERMISSIONS[role]) expect(PERMISSIONS).toContain(permission);
    }
  });

  it("CLIENT_VIEWER bersifat read-only dan tidak melihat RAB internal", () => {
    const perms = ROLE_PERMISSIONS.CLIENT_VIEWER;
    expect(perms).toContain("document.view");
    expect(perms).toContain("budget.client.view");
    expect(perms).not.toContain("budget.internal.view");
    expect(perms).not.toContain("users.manage");
    expect(perms).not.toContain("audit.view");
    for (const forbidden of ["expense.create", "invoice.edit", "gendoc.create", "project.close", "settings.manage"] as Permission[]) {
      expect(perms).not.toContain(forbidden);
    }
  });

  it("RAB internal hanya untuk ADMIN, PM, FINANCE", () => {
    const allowed = ROLES.filter((r) => ROLE_PERMISSIONS[r].includes("budget.internal.view"));
    expect(allowed.sort()).toEqual(["ADMIN", "FINANCE", "PM"]);
  });

  it("hanya ADMIN yang boleh mengelola pengguna & pengaturan", () => {
    expect(ROLES.filter((r) => has(r, "users.manage"))).toEqual(["ADMIN"]);
    expect(ROLES.filter((r) => has(r, "settings.manage"))).toEqual(["ADMIN"]);
  });

  it("FIELD tidak bisa approve biaya maupun finalize dokumen", () => {
    expect(has("FIELD", "progress.create")).toBe(true);
    expect(has("FIELD", "expense.approve")).toBe(false);
    expect(has("FIELD", "gendoc.finalize")).toBe(false);
  });
});

describe("hardening · ekspor tidak fail-open (SEC-05)", () => {
  const perms = (role: Role) => [...ROLE_PERMISSIONS[role]];

  it("menolak jenis ekspor yang tidak dikenal dengan 404", () => {
    expect(() => assertExportAllowed({ permissions: perms("ADMIN") }, "payroll"))
      .toThrowError(/tidak dikenal/);
    try { assertExportAllowed({ permissions: perms("ADMIN") }, "payroll"); }
    catch (e) { expect((e as { status?: number }).status).toBe(404); }
  });

  it("FIELD tanpa invoice.view mendapat 403 untuk ekspor invoice", () => {
    expect(() => assertExportAllowed({ permissions: perms("FIELD") }, "invoices"))
      .toThrowError(/invoice\.view/);
    try { assertExportAllowed({ permissions: perms("FIELD") }, "invoices"); }
    catch (e) { expect((e as { status?: number }).status).toBe(403); }
  });

  it("FIELD tetap boleh ekspor pengeluarannya sendiri", () => {
    expect(visibleBudgetTypes({ permissions: perms("FIELD") })).toEqual([]);
    expect(() => assertExportAllowed({ permissions: perms("FIELD") }, "expenses")).not.toThrow();
  });

  it("RAB internal hanya untuk pemegang budget.internal.view", () => {
    expect(visibleBudgetTypes({ permissions: perms("CLIENT_VIEWER") })).toEqual(["CLIENT"]);
    expect(visibleBudgetTypes({ permissions: perms("PROCUREMENT") })).toEqual(["CLIENT"]);
    expect(visibleBudgetTypes({ permissions: perms("FINANCE") })).toEqual(["CLIENT", "INTERNAL"]);
    expect(visibleBudgetTypes({ permissions: perms("ADMIN") })).toEqual(["CLIENT", "INTERNAL"]);
  });
});
