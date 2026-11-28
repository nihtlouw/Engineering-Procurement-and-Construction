/**
 * Membuat hash password yang siap ditempel ke kolom `users.password_hash`.
 *
 *   npm run db:hash-password -- --password 'Ard4yaPemulihan26'
 *   npm run db:hash-password -- --password 'Ard4yaPemulihan26' --sql
 *
 * Kenapa alat ini ada: password aplikasi ini disimpan sebagai scrypt
 * `salt:hash` (panjang total 161 karakter), BUKAN teks dan BUKAN md5/bcrypt.
 * Mengetik password biasa ke table editor Neon akan membuat akun mustahil
 * login — hash-nya tidak akan pernah cocok. Alat ini mengeluarkan string yang
 * tepat, dan dengan `--sql` sekaligus perintah UPDATE yang bisa ditempel ke
 * SQL editor Neon tanpa risiko salah kutip.
 *
 * Algoritma di sini SENGAJA diduplikasi dari `src/lib/auth.ts`
 * (scrypt N=16384/r=8/p=1, 64 byte, salt hex 16 byte) karena skrip CLI tidak
 * boleh meng-import modul yang memakai `next/headers`. Tests/unit/password-hash
 * memverifikasi keduanya menghasilkan format yang sama.
 */
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;

export function hashPasswordForStorage(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, KEY_LENGTH).toString("hex")}`;
}

/** Verifikasi terbalik untuk memastikan hash yang dicetak benar-benar cocok. */
export function verifyPasswordHash(password: string, stored: string): boolean {
  const [salt, key] = stored.split(":");
  if (!salt || !key) return false;
  const candidate = scryptSync(password, salt, KEY_LENGTH);
  const expected = Buffer.from(key, "hex");
  return expected.length === candidate.length && timingSafeEqual(candidate, expected);
}

/**
 * Membangun SQL reset password yang AMAN untuk kedua versi skema.
 *
 * Kenapa tidak langsung `failed_login_count = 0`: kolom itu baru ada setelah
 * migrasi 0010. Bila disebut langsung, seluruh `update` GAGAL di database yang
 * belum dimigrasi — padahal justru database itulah yang butuh reset darurat.
 * Blok `do` di bawah memeriksa `information_schema` lebih dulu, sehingga
 * pernyataan reset kunci hanya dijalankan bila kolomnya memang ada.
 */
export function buildResetSql(emails: string[], hash: string): string {
  const list = emails
    // Satu argumen boleh berisi beberapa alamat dipisah koma.
    .flatMap((email) => email.split(","))
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
    .map((email) => `'${email.replace(/'/g, "''")}'`)
    .join(", ");
  const hashLiteral = `'${hash.replace(/'/g, "''")}'`;
  return [
    "begin;",
    "",
    `update users set password_hash = ${hashLiteral}`,
    ` where email in (${list});`,
    "",
    "-- Reset kunci login HANYA bila kolomnya ada (kolom ini datang dari migrasi 0010).",
    "do $$",
    "begin",
    "  if exists (select 1 from information_schema.columns",
    "              where table_schema = 'public' and table_name = 'users'",
    "                and column_name = 'locked_until') then",
    "    update users set failed_login_count = 0, locked_until = null",
    `     where email in (${list});`,
    "  end if;",
    "end $$;",
    "",
    "-- Sesi lama wajib dicabut: password berganti berarti sesi lama tidak sah lagi.",
    `delete from sessions where user_id in (select id from users where email in (${list}));`,
    "",
    "commit;",
    "",
  ].join("\n");
}

/**
 * Apakah tabel `users` sudah punya kolom dari migrasi 0010?
 *
 * Skrip CLI yang menulis `failed_login_count`/`locked_until` akan GAGAL total di
 * database yang belum dimigrasi — persis kasus yang paling butuh pemulihan.
 * Karena itu keberadaan kolom diperiksa dulu, bukan diasumsikan.
 */
export async function hasLockColumns(query: (sql: string) => Promise<unknown>): Promise<boolean> {
  const result = (await query(
    "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'users' and column_name = 'locked_until'",
  )) as { rows?: unknown[] };
  return Array.isArray(result?.rows) && result.rows.length > 0;
}

function parseArgs(argv: string[]) {
  const args: { password?: string; email?: string; sql: boolean } = { sql: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--sql") args.sql = true;
    else if (token === "--email" || token === "--emails") args.email = argv[index + 1];
    else if (token === "--password") args.password = argv[index + 1];
    else if (token.startsWith("--email=")) args.email = token.slice("--email=".length);
    else if (token.startsWith("--emails=")) args.email = token.slice("--emails=".length);
    else if (token.startsWith("--password=")) args.password = token.slice("--password=".length);
  }
  return args;
}

function main() {
  const { password, email, sql } = parseArgs(process.argv.slice(2));
  if (!password) {
    console.error("Jalankan di TERMINAL (folder repo), bukan di SQL editor database.");
    console.error("Pemakaian: npm run db:hash-password -- --password '...' [--email <email>] [--sql]");
    console.error("Opsional: --email dipakai untuk mencetak pernyataan UPDATE yang siap ditempel.");
    process.exitCode = 1;
    return;
  }
  if (password.length < 12) {
    console.error("Password minimal 12 karakter (aturan yang sama dengan reset password).");
    process.exitCode = 1;
    return;
  }
  if (!(/[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password))) {
    console.error("Password harus memuat huruf kecil, huruf besar, dan angka.");
    process.exitCode = 1;
    return;
  }

  const hash = hashPasswordForStorage(password);
  if (!verifyPasswordHash(password, hash)) {
    console.error("Hash gagal diverifikasi — jangan dipakai. Laporkan ini sebagai bug.");
    process.exitCode = 1;
    return;
  }

  console.log("Hash siap ditempel ke kolom users.password_hash:\n");
  console.log(hash);
  console.log(`\nPanjang: ${hash.length} karakter (salt 32 + titik dua + hash 128).`);

  if (email) {
    console.log("\nPerintah SQL (tempel di SQL editor Neon, jalankan seluruhnya dalam satu transaksi):\n");
    console.log(buildResetSql([email], hash));
    console.log("Dua pernyataan terakhir ikut WAJIB: tanpa itu sesi lama tetap hidup");
    console.log("dan akun yang sedang terkunci tetap menolak login 15 menit.");
  } else if (sql) {
    console.log("\nTambahkan --email <email> untuk sekalian mencetak perintah UPDATE + hapus sesi.");
  } else {
    console.log("\nBaris di atas adalah perintah TERMINAL. Untuk Neon, pakai blok SQL yang dicetak");
  console.log("dengan --email, atau tempel hash-nya langsung di table editor.");
  console.log("\nPetunjuk table editor Neon: buka tabel `users` → baris akun → kolom");
    console.log("`password_hash` → Edit → tempel hash di atas (JANGAN diketik).");
    console.log("Setelah itu set `failed_login_count` = 0 dan `locked_until` = NULL pada baris yang sama.");
    console.log("Untuk satu perintah lengkap, ulangi dengan --email <email>.");
  }
}

// Hanya jalankan bila dieksekusi langsung (bukan saat di-import tes).
if (process.argv[1]?.includes("hash-password")) main();
