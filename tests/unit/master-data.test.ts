import { describe, expect, it } from "vitest";
import {
  buildClientCode, buildProjectCode, CODE_PATTERN, CLIENT_CODE_PATTERN, PROJECT_CODE_PATTERN,
  maxSequence, PROJECT_ROLES, PROJECT_SEQ_PATTERN,
} from "@/modules/master-data/types";
import {
  clientSchema, projectMemberSchema, projectSchema, projectUpdateSchema, siteSchema,
} from "@/modules/master-data/validation";

describe("master data · kode otomatis", () => {
  it("membuat kode proyek & klien berurut dengan padding", () => {
    expect(buildProjectCode(2026, 1)).toBe("PRJ-2026-001");
    expect(buildProjectCode(2026, 1234)).toBe("PRJ-2026-1234");
    expect(buildClientCode(7)).toBe("CLI-007");
  });

  it("mengambil nomor urut terbesar dan mengabaikan kode asing", () => {
    // Nomor urut lintas tahun dipakai agar kode tidak bertabrakan dengan tahun lain.
    expect(maxSequence(["PRJ-2026-001", "PRJ-2026-014", "PRJ-2025-099", "KHUSUS-A"], PROJECT_SEQ_PATTERN)).toBe(99);
    expect(PROJECT_CODE_PATTERN.test("PRJ-2026-014")).toBe(true);
    expect(maxSequence(["CLI-002", "CLI-010", ""], CLIENT_CODE_PATTERN)).toBe(10);
    expect(maxSequence([], PROJECT_SEQ_PATTERN)).toBe(0);
  });

  it("pola kode menolak karakter berbahaya & terlalu pendek", () => {
    expect(CODE_PATTERN.test("PRJ-2026-001")).toBe(true);
    expect(CODE_PATTERN.test("A")).toBe(false);
    expect(CODE_PATTERN.test("proyek satu")).toBe(false);
    expect(CODE_PATTERN.test("PRJ/2026")).toBe(false);
    expect(CODE_PATTERN.test("-PRJ")).toBe(false);
  });

  it("memuat 7 peran proyek yang selaras company role", () => {
    expect([...PROJECT_ROLES]).toEqual(["ADMIN", "ESTIMATOR", "PM", "FIELD", "PROCUREMENT", "FINANCE", "CLIENT_VIEWER"]);
  });
});

describe("master data · validasi input", () => {
  it("klien wajib nama legal, nama tampilan, dan industri", () => {
    expect(() => clientSchema.parse({ legalName: "PT A", displayName: "A", industry: "Energi" })).toThrow();
    const ok = clientSchema.parse({ legalName: "PT Ardaya", displayName: "Ardaya", industry: "Energi" });
    expect(ok.legalName).toBe("PT Ardaya");
    expect(ok.npwp).toBeUndefined();
  });

  it("kode klien opsional; bila diisi harus format valid", () => {
    const base = { legalName: "PT Ardaya", displayName: "Ardaya", industry: "Energi" };
    expect(clientSchema.parse({ ...base, code: "cli-001" }).code).toBe("CLI-001"); // di-uppercase
    expect(() => clientSchema.parse({ ...base, code: "cli 1" })).toThrow();
  });

  it("site wajib memilih klien dan nama minimal 2 karakter", () => {
    expect(() => siteSchema.parse({ clientId: "", name: "Grid" })).toThrow();
    expect(() => siteSchema.parse({ clientId: "c1", name: "G" })).toThrow();
    expect(siteSchema.parse({ clientId: "c1", name: "Grid A" }).name).toBe("Grid A");
  });

  it("proyek: judul min 5 karakter, nilai kontrak numerik, tanggal konsisten", () => {
    const base = { title: "Instalasi Genset", clientId: "c1", contractValue: "0" };
    expect(() => projectSchema.parse({ ...base, title: "AB" })).toThrow();
    expect(() => projectSchema.parse({ ...base, contractValue: "1.234,56" })).toThrow();
    expect(() => projectSchema.parse({ ...base, startDate: "2026-05-01", targetEndDate: "2026-04-01" }))
      .toThrowError(/Target selesai/);
    expect(() => projectSchema.parse({ ...base, contractDate: "2026-05-01", startDate: "2026-04-01" }))
      .toThrowError(/Tanggal mulai/);
    const ok = projectSchema.parse({ ...base, contractValue: "5035000000", retentionPct: "5", warrantyMonths: 12 });
    expect(ok.contractValue).toBe("5035000000");
  });

  it("proyek: anggota opsional divalidasi terhadap peran proyek", () => {
    expect(() => projectSchema.parse({
      title: "Instalasi Genset", clientId: "c1", contractValue: "0",
      members: [{ userId: "u1", projectRole: "SUPERUSER" }],
    })).toThrow();
    const ok = projectSchema.parse({
      title: "Instalasi Genset", clientId: "c1", contractValue: "0",
      members: [{ userId: "u1", projectRole: "PM" }],
    });
    expect(ok.members?.[0].projectRole).toBe("PM");
  });

  it("PATCH proyek menolak body kosong", () => {
    expect(() => projectUpdateSchema.parse({})).toThrowError(/Minimal satu field/);
    expect(projectUpdateSchema.parse({ title: "Instalasi Genset 2" }).title).toBe("Instalasi Genset 2");
  });

  it("anggota proyek wajib pengguna + peran yang dikenal", () => {
    expect(() => projectMemberSchema.parse({ userId: "", projectRole: "PM" })).toThrow();
    expect(() => projectMemberSchema.parse({ userId: "u1", projectRole: "OWNER" })).toThrow();
    expect(projectMemberSchema.parse({ userId: "u1", projectRole: "CLIENT_VIEWER" }).projectRole).toBe("CLIENT_VIEWER");
  });
});
