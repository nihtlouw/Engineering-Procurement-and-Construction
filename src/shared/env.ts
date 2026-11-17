/**
 * Validasi environment saat RUNTIME, bukan saat import modul.
 *
 * Alasan: `next build` meng-import seluruh route module tanpa DATABASE_URL.
 * Melempar di module scope membuat build/CI gagal (temuan audit #4). Di sini
 * konfigurasi diverifikasi pada request pertama sehingga production tetap
 * fail-fast, sementara build tetap bisa mengumpulkan page data.
 */
const MIN_SECRET_LENGTH = 32;

export function assertRuntimeEnv(): void {
  const missing: string[] = [];
  if (!process.env.DATABASE_URL) missing.push("DATABASE_URL");
  if (process.env.NODE_ENV === "production") {
    const secret = process.env.FILE_SIGNING_SECRET;
    if (!secret || secret.length < MIN_SECRET_LENGTH) {
      missing.push(`FILE_SIGNING_SECRET (>= ${MIN_SECRET_LENGTH} karakter acak)`);
    }
  }
  if (missing.length) {
    throw new Error(`Konfigurasi server belum lengkap: ${missing.join(", ")}. Periksa environment Vercel.`);
  }
}

export function fileSigningSecret(): string {
  const secret = process.env.FILE_SIGNING_SECRET;
  if (secret && secret.length >= MIN_SECRET_LENGTH) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("FILE_SIGNING_SECRET wajib diisi (>= 32 karakter) di production.");
  }
  // Jelas bertanda dev-only. TIDAK pernah dipakai saat NODE_ENV=production.
  return "dev-only-insecure-file-signing-secret-do-not-use-in-prod";
}
