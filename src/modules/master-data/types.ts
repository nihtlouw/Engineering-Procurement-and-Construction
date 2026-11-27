/** Master data (tahap 2): konstanta & tipe. Tidak ada logika bisnis di sini. */

/** Peran yang bisa ditugaskan pada `project_members.project_role` (selaras company role). */
export const PROJECT_ROLES = ["ADMIN", "ESTIMATOR", "PM", "FIELD", "PROCUREMENT", "FINANCE", "CLIENT_VIEWER"] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

export const CLIENT_REQUIRED_FIELDS = ["code", "legalName", "displayName", "industry"] as const;

/**
 * Aturan kode master data. Kode dipakai pada dokumen resmi dan nomor proyek,
 * jadi sengaja ketat: huruf besar/angka/titik-garis, 2–40 karakter.
 */
export const CODE_PATTERN = /^[A-Z0-9][A-Z0-9._-]{1,39}$/;

/** Kode proyek otomatis: PRJ-YYYY-NNN (diurutkan per company per tahun). */
export function buildProjectCode(year: number, sequence: number): string {
  return `PRJ-${year}-${String(sequence).padStart(3, "0")}`;
}

/** Kode klien otomatis: CLI-NNN. */
export function buildClientCode(sequence: number): string {
  return `CLI-${String(sequence).padStart(3, "0")}`;
}

/** Ambil nomor urut terbesar dari kode berformat PREFIX-..., aman untuk input kotor. */
export function maxSequence(codes: string[], pattern: RegExp): number {
  let max = 0;
  for (const code of codes) {
    const match = pattern.exec(code);
    const value = match ? Number(match[1]) : NaN;
    if (Number.isFinite(value) && value > max) max = value;
  }
  return max;
}

export const PROJECT_CODE_PATTERN = /^PRJ-(\d{4})-(\d{1,6})$/;
/** Sama seperti di atas, tetapi nomor urut ada di grup 1 (untuk `maxSequence`). */
export const PROJECT_SEQ_PATTERN = /^PRJ-\d{4}-(\d{1,6})$/;
export const CLIENT_CODE_PATTERN = /^CLI-(\d{1,6})$/;

/** Tahap awal proyek baru selalu AWAITING_KICKOFF (stage gate S1 tetap berlaku). */
export const INITIAL_STAGE = "AWAITING_KICKOFF";

export type MasterDataOptions = {
  users: { id: string; name: string; role: string; title: string }[];
  clients: { id: string; code: string; displayName: string; legalName: string }[];
  sites: { id: string; clientId: string; name: string; address: string | null }[];
};

/* -------------------------------------------------------------------------- */
/* Tahap 3 · termin kontrak & katalog biaya                                   */
/* -------------------------------------------------------------------------- */

export const TERM_TYPES = ["DP", "MOS", "PROGRESS", "FINAL", "RETENTION", "OTHER"] as const;
export type TermType = (typeof TERM_TYPES)[number];

/** Persen termin dijumlahkan; toleransi pembulatan 0,01%. */
export const TERM_PERCENT_TOLERANCE = 0.01;

export type TermDraft = { percent: string | null; type: string };

export type TermComposition = {
  totalPercent: number;
  warning: string | null;
  usesAmountOnly: boolean;
};

/**
 * Aturan komposisi termin (murni, dipakai UI & service):
 *  - Termin berbasis persen harus berjumlah 100% (retensi boleh terpisah).
 *  - Termin tanpa persen memakai nominal manual → tidak ada validasi 100%.
 */
export function summarizeTermComposition(terms: TermDraft[]): TermComposition {
  const percentTerms = terms.filter((t) => t.percent !== null && t.percent !== "");
  const totalPercent = percentTerms.reduce((sum, t) => sum + Number(t.percent), 0);
  const usesAmountOnly = percentTerms.length !== terms.length;
  let warning: string | null = null;
  if (percentTerms.length && Math.abs(totalPercent - 100) > TERM_PERCENT_TOLERANCE) {
    warning = `Total persen termin ${totalPercent.toFixed(2)}% — seharusnya 100%.`;
  }
  return { totalPercent, warning, usesAmountOnly };
}

/** Retensi tidak boleh muncul lebih dari sekali per proyek (mencegah potongan ganda). */
export function assertSingleRetention(terms: { type: string }[]): string | null {
  return terms.filter((t) => t.type === "RETENTION").length > 1
    ? "Termin RETENTION hanya boleh satu per proyek."
    : null;
}
