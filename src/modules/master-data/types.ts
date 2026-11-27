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
