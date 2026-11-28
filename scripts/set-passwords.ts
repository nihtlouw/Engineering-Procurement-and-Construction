/**
 * Reset password BANYAK akun sekaligus lewat CLI — untuk "menyiapkan password
 * setiap akun user" setelah data demo diimpor, tanpa membuka tool tempel-tempel
 * SQL satu per satu.
 *
 *   npm run db:set-passwords                       # semua akun dapat password acak berbeda
 *   npm run db:set-passwords -- --only-demo        # hanya 6 akun demo @ardaya.id
 *   npm run db:set-passwords -- --all-password 'Rahasia12345'
 *   npm run db:set-passwords -- --email a@x.id,b@x.id --password 'Rahasia12345'
 *   npm run db:set-passwords -- --dry-run          # lihat siapa yang kena, tanpa menulis
 *
 * Keputusan desain:
 * - Default = password ACAK BERBEDA per akun. Satu password untuk semua akun
 *   adalah persis masalah yang sedang dibereskan (6 akun demo berbagi 1 hash).
 * - Password hanya dicetak SEKALI ke tabel terminal (stdout), tidak pernah
 *   disimpan aplikasi. Yang ditulis ke database hanya hash scrypt.
 * - Seluruh sesi akun yang direset ikut dicabut, dan audit `PASSWORD_RESET_CLI`
 *   ditulis per akun (bila tabel audit tersedia).
 * - Tahan skema pra-0010: kolom `failed_login_count`/`locked_until` hanya
 *   disentuh bila memang ada.
 *
 * Aman dijalankan di production: ini alat administratif, bukan seed demo.
 */
import { randomBytes, scryptSync } from "node:crypto";
import { config } from "dotenv";
import { eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { activityLogs, companies, memberships, sessions, users } from "../src/db/schema";
import { hasLockColumns } from "./hash-password";

config({ path: ".env.local", quiet: true });

/** Huruf besar/kecil/angka, tanpa karakter ambigu (0/O, 1/l/I). */
function randomPassword(length = 20): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(length);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

/** Akun demo bawaan seed. Daftar eksplisit supaya tidak ada tebakan pola. */
const DEMO_EMAILS = [
  "admin@ardaya.id", "estimator@ardaya.id", "field@ardaya.id",
  "finance@ardaya.id", "pm@ardaya.id", "procurement@ardaya.id",
];

function parseArgs(argv: string[]) {
  const args: {
    emails: string[]; password?: string; allPassword?: string;
    onlyDemo: boolean; dryRun: boolean; includeInactive: boolean;
  } = { emails: [], onlyDemo: false, dryRun: false, includeInactive: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const value = argv[index + 1];
    if (token === "--email" || token === "--emails") { args.emails.push(value ?? ""); index += 1; }
    else if (token === "--password") { args.password = value; index += 1; }
    else if (token === "--all-password") { args.allPassword = value; index += 1; }
    else if (token === "--only-demo") args.onlyDemo = true;
    else if (token === "--dry-run") args.dryRun = true;
    else if (token === "--include-inactive") args.includeInactive = true;
    else if (token.startsWith("--email=")) args.emails.push(token.slice("--email=".length));
    else if (token.startsWith("--emails=")) args.emails.push(token.slice("--emails=".length));
    else if (token.startsWith("--password=")) args.password = token.slice("--password=".length);
    else if (token.startsWith("--all-password=")) args.allPassword = token.slice("--all-password=".length);
  }
  return args;
}

function assertStrong(password: string, label: string): void {
  if (password.length < 12) throw new Error(`${label}: minimal 12 karakter.`);
  if (!(/[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password))) {
    throw new Error(`${label}: harus memuat huruf kecil, huruf besar, dan angka.`);
  }
}

async function main() {
  // Argumen divalidasi SEBELUM menyentuh database: kesalahan ketik tidak boleh
  // terlihat seperti masalah koneksi.
  const args = parseArgs(process.argv.slice(2));
  if (args.allPassword) assertStrong(args.allPassword, "--all-password");
  if (args.password) assertStrong(args.password, "--password");
  if (args.password && args.emails.length === 0) {
    throw new Error("--password hanya masuk akal untuk akun tertentu. Pakai --email <alamat>.");
  }
  if (args.password && args.emails.length > 1) {
    throw new Error("--password dipakai untuk SATU akun (--email a@x.id). Untuk banyak akun sambil tetap berbeda, gunakan --all-password.");
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL belum diisi (set di .env.local atau environment).");

  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle(pool);
  try {
    // Pilih akun sasaran.
    const where = args.emails.length
      ? inArray(users.email, args.emails.flatMap((entry) => entry.split(",")).map((entry) => entry.trim().toLowerCase()).filter(Boolean))
      : args.onlyDemo
        ? inArray(users.email, DEMO_EMAILS)
        : undefined;

    const rows = await db.select({
      id: users.id, name: users.name, email: users.email, role: users.role, isActive: users.isActive,
    }).from(users).where(where).orderBy(users.email);

    if (rows.length === 0) {
      console.log("Tidak ada akun yang cocok. Periksa daftar email (disimpan huruf kecil).");
      return;
    }
    const targets = args.includeInactive ? rows : rows.filter((row) => row.isActive);
    const skipped = rows.length - targets.length;
    if (targets.length === 0) {
      console.log("Semua akun yang cocok sedang nonaktif; tambahkan --include-inactive bila memang disengaja.");
      return;
    }

    console.log(`Akun sasaran: ${targets.length}${skipped ? ` (${skipped} nonaktif dilewati)` : ""}.`);
    if (args.dryRun) {
      for (const row of targets) console.log(`  - ${row.email} (${row.role})`);
      console.log("\n--dry-run: tidak ada yang ditulis. Ulangi tanpa --dry-run.");
      return;
    }
    if (args.allPassword) {
      console.log("PERINGATAN: --all-password membuat satu password berlaku untuk semua akun sasaran.");
      console.log("           Setelah masuk, tiap orang tetap harus menggantinya sendiri.");
    }

    const lockColumns = await hasLockColumns((sqlText) => pool.query(sqlText));
    if (!lockColumns) console.log("Catatan: kolom kunci login belum ada (migrasi 0010 belum jalan) — dilewati.");

    // Audit butuh GUC company; satu audit per akun pada company pertama akun itu.
    const auditCompany = await db.select({ userId: memberships.userId, companyId: memberships.companyId, name: companies.name })
      .from(memberships).innerJoin(companies, eq(companies.id, memberships.companyId))
      .where(inArray(memberships.userId, targets.map((row) => row.id)));

    const results: { email: string; role: string; password: string; sessions: number }[] = [];
    for (const row of targets) {
      const password = args.allPassword ?? args.password ?? randomPassword();
      await db.update(users).set({
        passwordHash: hashPassword(password),
        ...(lockColumns ? { failedLoginCount: 0, lockedUntil: null } : {}),
      }).where(eq(users.id, row.id));

      const activeSessions = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, row.id));
      await db.delete(sessions).where(eq(sessions.userId, row.id));

      const company = auditCompany.find((entry) => entry.userId === row.id);
      if (company) {
        try {
          await pool.query("SELECT set_config('app.current_company_id', $1, false)", [company.companyId]);
          await db.insert(activityLogs).values({
            id: `audit-${randomBytes(12).toString("hex")}`,
            companyId: company.companyId,
            objectType: "USER", objectId: row.id, action: "PASSWORD_RESET_CLI",
            changes: [{ field: "passwordHash", old: "[redacted]", new: "[redacted]" }],
            reason: "Penetapan password massal lewat CLI",
          });
        } catch {
          // Tabel audit bisa belum ada pada instalasi lama; reset tetap sah.
          console.log(`  (audit dilewati untuk ${row.email})`);
        }
      }
      results.push({ email: row.email, role: row.role, password, sessions: activeSessions.length });
    }

    console.log("\nSelesai. Password di bawah tampil SEKALI — serahkan lewat kanal pribadi, jangan di grup.\n");
    const width = Math.max(...results.map((row) => row.email.length));
    console.log(`${"EMAIL".padEnd(width)}  ${"ROLE".padEnd(12)}  PASSWORD`);
    console.log(`${"-".repeat(width)}  ${"-".repeat(12)}  ${"-".repeat(20)}`);
    for (const row of results) {
      console.log(`${row.email.padEnd(width)}  ${row.role.padEnd(12)}  ${row.password}`);
    }
    console.log(`\nSesi dicabut: ${results.reduce((total, row) => total + row.sessions, 0)}.`);
    console.log("Minta setiap pengguna mengganti password lewat menu akun setelah masuk pertama kali.");
  } finally {
    await pool.end();
  }
}

// Hanya jalankan bila dieksekusi langsung (bukan saat di-import tes).
if (process.argv[1]?.includes("set-passwords")) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

export { DEMO_EMAILS, parseArgs, assertStrong };
