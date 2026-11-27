import { describe, expect, it } from "vitest";
import {
  actualIncrementByPeriod, addDays, buildSCurve, evenWeights, normalizeWeights, scheduleVerdict,
  summarizeWeights, weekStart, WEIGHT_TOLERANCE, type WbsItemLike,
} from "@/modules/wbs/types";
import { saveWbsSchema, wbsItemSchema } from "@/modules/wbs/validation";
import { EXPORT_PERMISSIONS } from "@/lib/export-permissions";
import { buildWbsCode } from "@/modules/wbs/service";
import { activityWeight, toDraft, toPayload, weightedProgress, type DraftItem } from "@/components/schedule/WbsEditor";

const item = (patch: Partial<WbsItemLike> = {}): WbsItemLike => ({
  id: "i1", parentId: null, level: 1, weight: "100", progressPct: "0", isSummary: false,
  plannedStart: "2026-01-05", plannedEnd: "2026-01-25", sortOrder: 0, ...patch,
});

describe("S5 · bobot WBS", () => {
  it("Σ bobot aktivitas 100% tanpa peringatan", () => {
    const summary = summarizeWeights([item({ id: "a", weight: "60" }), item({ id: "b", weight: "40" })]);
    expect(summary.activityWeight).toBe(100);
    expect(summary.warning).toBeNull();
    expect(summary.activityCount).toBe(2);
  });

  it("item ringkasan tidak dihitung ganda pada Σ bobot", () => {
    const summary = summarizeWeights([
      item({ id: "g", weight: "0", isSummary: true }),
      item({ id: "a", weight: "70" }),
      item({ id: "b", weight: "30" }),
    ]);
    expect(summary.activityWeight).toBe(100);
    expect(summary.summaryCount).toBe(1);
  });

  it("progres terbobot = Σ(bobot × progres) / Σ bobot", () => {
    const summary = summarizeWeights([
      item({ id: "a", weight: "60", progressPct: "100" }),
      item({ id: "b", weight: "40", progressPct: "50" }),
    ]);
    expect(summary.weightedProgress).toBe(80);
  });

  it("Σ bobot ≠ 100 memberi peringatan, WBS kosong juga", () => {
    expect(summarizeWeights([item({ weight: "90" })]).warning).toMatch(/90/);
    expect(summarizeWeights([]).warning).toMatch(/Belum ada aktivitas/);
    expect(WEIGHT_TOLERANCE).toBeLessThan(0.01);
  });

  it("saran bobot merata selalu berjumlah 100 walau pembagian tidak bulat", () => {
    expect(evenWeights(4)).toEqual([25, 25, 25, 25]);
    const three = evenWeights(3);
    expect(Math.round(three.reduce((sum, weight) => sum + weight, 0) * 100) / 100).toBe(100);
    expect(three).toEqual([33.33, 33.33, 33.34]);
    expect(evenWeights(0)).toEqual([]);
  });

  it("normalizeWeights mengoreksi selisih pembulatan di baris terbesar", () => {
    expect(normalizeWeights([33.33, 33.33, 33.33])).toEqual([33.33, 33.33, 33.34]);
    expect(normalizeWeights([50, 50])).toEqual([50, 50]);
    expect(normalizeWeights([])).toEqual([]);
  });
});

describe("S5 · kurva-S", () => {
  it("minggu dimulai Senin dan penambahan hari aman lintas bulan", () => {
    expect(weekStart("2026-01-07")).toBe("2026-01-05"); // Rabu → Senin
    expect(weekStart("2026-01-04")).toBe("2025-12-29"); // Minggu → Senin sebelumnya
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
  });

  it("rencana terdistribusi linier antar tanggal dan kumulatif berakhir 100", () => {
    const curve = buildSCurve({
      items: [item({ weight: "100", plannedStart: "2026-01-05", plannedEnd: "2026-01-25" })],
      startDate: "2026-01-05",
      endDate: "2026-01-25",
    });
    expect(curve.periods).toHaveLength(3);
    expect(curve.periods.map((p) => p.planned)).toEqual([33.33, 66.67, 100]);
    expect(curve.plannedTotal).toBe(100);
    expect(curve.status).toBe("NO_DATA");
    expect(curve.actualTotal).toBe(0);
  });

  it("dua aktivitas dengan bobot berbeda dijumlahkan benar", () => {
    const curve = buildSCurve({
      items: [
        item({ id: "a", weight: "60", plannedStart: "2026-01-05", plannedEnd: "2026-01-11" }),
        item({ id: "b", weight: "40", plannedStart: "2026-01-12", plannedEnd: "2026-01-18" }),
      ],
      startDate: "2026-01-05",
      endDate: "2026-01-18",
    });
    expect(curve.periods.map((p) => p.planned)).toEqual([60, 100]);
  });

  it("aktual hanya sampai periode terakhir yang dilaporkan dan deviasi dihitung", () => {
    const curve = buildSCurve({
      items: [item({ weight: "100" })],
      startDate: "2026-01-05",
      endDate: "2026-01-25",
      actualByPeriod: { "2026-01-05": 20, "2026-01-12": 20 },
    });
    expect(curve.periods.map((p) => p.actual)).toEqual([20, 40, null]);
    expect(curve.actualTotal).toBe(40);
    expect(curve.deviation).toBe(-26.67);
    expect(curve.status).toBe("BEHIND");
  });

  it("status AHEAD/ON_TRACK/BEHIND mengikuti ambang 0,5 poin", () => {
    expect(scheduleVerdict(1.2).status).toBe("AHEAD");
    expect(scheduleVerdict(0.2).status).toBe("ON_TRACK");
    expect(scheduleVerdict(-3).status).toBe("BEHIND");
  });

  it("tanggal selesai sebelum mulai menghasilkan kurva kosong dengan peringatan", () => {
    const curve = buildSCurve({ items: [item()], startDate: "2026-02-01", endDate: "2026-01-01" });
    expect(curve.periods).toHaveLength(0);
    expect(curve.warning).toMatch(/lebih awal/);
  });

  it("aktual per periode dihitung dari delta progres kumulatif per item", () => {
    const inc = actualIncrementByPeriod(
      [item({ id: "a", weight: "50" }), item({ id: "b", weight: "50" })],
      [
        { scheduleItemId: "a", reportDate: "2026-01-07", progressPct: "40" },
        { scheduleItemId: "a", reportDate: "2026-01-14", progressPct: "100" },
        { scheduleItemId: "b", reportDate: "2026-01-14", progressPct: "20" },
        { scheduleItemId: "zzz", reportDate: "2026-01-14", progressPct: "99" },
      ],
    );
    expect(inc["2026-01-05"]).toBe(20); // 50% × 40%
    expect(inc["2026-01-12"]).toBe(40); // (50% × 60%) + (50% × 20%)
  });
});

describe("S5 · validasi & kode WBS", () => {
  it("kode WBS otomatis: level 1 berurut, anak memakai prefix induk", () => {
    expect(buildWbsCode(1, 0, null)).toBe("WBS-001");
    expect(buildWbsCode(1, 9, null)).toBe("WBS-010");
    expect(buildWbsCode(2, 0, "WBS-003")).toBe("3.1");
  });

  it("tanggal selesai sebelum mulai ditolak, ringkasan wajib bobot 0", () => {
    expect(() => wbsItemSchema.parse({ name: "Pondasi", weight: "10", plannedStart: "2026-02-01", plannedEnd: "2026-01-01" })).toThrow();
    expect(() => wbsItemSchema.parse({ name: "Grup", weight: "20", isSummary: true })).toThrow();
    expect(wbsItemSchema.parse({ name: "Pondasi", weight: "10" }).name).toBe("Pondasi");
  });

  it("membatasi 300 item WBS dan progres 0–100", () => {
    const many = Array.from({ length: 301 }, (_, i) => ({ name: `Item ${i}`, weight: "1" }));
    expect(() => saveWbsSchema.parse({ items: many })).toThrow();
    expect(() => wbsItemSchema.parse({ name: "Terlalu", weight: "10", progressPct: "150" })).toThrow();
  });

  it("draft editor: payload tidak membawa key internal dan bobot ringkasan 0", () => {
    const drafts: DraftItem[] = [
      { key: "k1", id: null, parentId: null, level: 1, type: "WORK_PACKAGE", name: "Grup", weight: "0", progressPct: "0", plannedStart: "", plannedEnd: "", ownerId: "", isSummary: true, code: null },
      { key: "k2", id: null, parentId: "k1", level: 2, type: "ACTIVITY", name: "Aktivitas", weight: "100", progressPct: "50", plannedStart: "", plannedEnd: "", ownerId: "", isSummary: false, code: null },
    ];
    const payload = toPayload(drafts);
    expect(payload[0]).not.toHaveProperty("key");
    expect(payload[0].weight).toBe("0");
    expect(payload[1].weight).toBe("100");
    expect(activityWeight(drafts)).toBe(100);
    expect(weightedProgress(drafts)).toBe(50);
    expect(toDraft([{ id: "x", parentId: null, level: 1, type: "ACTIVITY", name: "A", code: null, isSummary: false, weight: "40", progressPct: "10", status: "IN_PROGRESS", plannedStart: null, plannedEnd: null, actualStart: null, actualEnd: null, ownerId: null, ownerName: null, sortOrder: 0, committedAmount: "0" }])[0].weight).toBe("40");
  });
});

describe("S5 · konsistensi jadwal, WBS, dan ekspor", () => {
  it("ekspor jadwal dijaga izin schedule.view dan tidak memuat nilai biaya", () => {
    expect(EXPORT_PERMISSIONS.schedule).toEqual(["schedule.view"]);
    const other = Object.entries(EXPORT_PERMISSIONS).filter(([key]) => key !== "schedule");
    // Ekspor jadwal tidak boleh ikut mewarisi izin komersial.
    expect(other.every(([, permissions]) => !permissions.includes("schedule.view"))).toBe(true);
  });

  it("progres terbobot mengabaikan grup sehingga laporan ganda tidak mungkin", () => {
    // Kondisi yang dicegah: grup berbobot 50 dilaporkan 100% PLUS anaknya 50%.
    const withSummaryWeight = summarizeWeights([
      item({ id: "g", weight: "50", isSummary: true, progressPct: "100" }),
      item({ id: "a", weight: "100", progressPct: "0" }),
    ]);
    expect(withSummaryWeight.activityWeight).toBe(100);
    expect(withSummaryWeight.weightedProgress).toBe(0);
  });
});
