/**
 * Reset password lewat CLI — jalur darurat ketika TIDAK ADA admin yang bisa masuk.
 *
 *   npm run db:reset-password -- --email admin@ardaya.id
 *   npm run db:reset-password -- --email admin@ardaya.id --password 'Rahasia12345'
 *
 * Tanpa `--password`, password acak 20 karakter dibuat dan HANYA ditampilkan
 * sekali di terminal (tidak pernah disimpan dalam bentuk terbaca). Setelah
 * berhasil, seluruh sesi akun tersebut dicabut dan penghitung kegagalan login
 * dikembalikan ke 0.
 *
 * Kenapa CLI dan bukan endpoint publik: aplikasi ini tidak mengirim email, jadi
 * "lupa password" lewat tautan email tidak bisa diverifikasi. Menambahkan reset
 * tanpa verifikasi berarti siapa pun yang tahu email dapat mengambil alih akun.
 * Jalur CLI mengharuskan akses ke environment (DATABASE_URL) — tingkat akses yang
 * setara dengan pemilik sistem.
 *
 * Aman dijalankan di production: ini satu-satunya skrip yang memang ditujukan
 * untuk pemulihan produksi (berbeda dari seed demo yang diblokir).
 */
import { randomBytes, scryptSync } from "node:crypto";
import { config } from "dotenv";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { activityLogs, companies, memberships, sessions, users } from "../src/db/schema";
import { hasLockColumns } from "./hash-password";

config({ path: ".env.local", quiet: true });

/** Huruf besar/kecil/angka, tanpa karakter ambigu (0/O, 1/l/I). */
function randomPassword(length = 20) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(length);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

function parseArgs(argv: string[]) {
  const args: { email?: string; password?: string } = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--email") args.email = argv[index + 1];
    else if (token === "--password") args.password = argv[index + 1];
    else if (token.startsWith("--email=")) args.email = token.slice("--email=".length);
    else if (token.startsWith("--password=")) args.password = token.slice("--password=".length);
  }
  return args;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL belum diisi.");
  const { email, password: provided } = parseArgs(process.argv.slice(2));
  if (!email) {
    throw new Error("Pemakaian: npm run db:reset-password -- --email <email> [--password <baru>]");
  }

  const password = provided ?? randomPassword();
  if (password.length < 12) throw new Error("Password minimal 12 karakter.");
  if (provided && !(/[a-z]/.test(provided) && /[A-Z]/.test(provided) && /\d/.test(provided))) {
    throw new Error("Password harus memuat huruf kecil, huruf besar, dan angka.");
  }

  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle(pool);
  try {
    const [account] = await db.select({ id: users.id, name: users.name, email: users.email })
      .from(users).where(eq(users.email, email.toLowerCase().trim())).limit(1);

    // `activity_logs.company_id` NOT NULL DEFAULT app_current_company_id().
    // Tanpa GUC ini insert audit akan gagal dan seluruh reset ikut gagal.
    const membershipsOfUser = account
      ? await db.select({ companyId: memberships.companyId, slug: companies.slug, name: companies.name })
        .from(memberships)
        .innerJoin(companies, eq(companies.id, memberships.companyId))
        .where(eq(memberships.userId, account.id))
        .orderBy(memberships.createdAt)
      : [];
    const companyId = membershipsOfUser[0]?.companyId ?? null;
    if (companyId) await db.execute(sql`select set_config('app.current_company_id', ${companyId}, false)`);
    if (!account) {
      throw new Error(`Akun dengan email ${email} tidak ditemukan. Periksa ejaan; email disimpan dalam huruf kecil.`);
    }

    const activeSessions = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, account.id));
    // Kolom kunci login hanya ada setelah migrasi 0010. Menyebutnya tanpa
    // pemeriksaan membuat reset darurat gagal di database yang belum dimigrasi.
    const lockColumns = await hasLockColumns((sqlText) => pool.query(sqlText));
    await db.update(users).set({
      passwordHash: hashPassword(password),
      ...(lockColumns ? { failedLoginCount: 0, lockedUntil: null } : {}),
    }).where(eq(users.id, account.id));
    if (!lockColumns) {
      console.log("Catatan: kolom kunci login belum ada (migrasi 0010 belum diterapkan) — dilewati.");
    }
    await db.delete(sessions).where(eq(sessions.userId, account.id));

    if (!companyId) {
      throw new Error("Akun tidak terdaftar pada company mana pun; reset dibatalkan agar tidak meninggalkan audit tanpa tenant.");
    }
    await db.insert(activityLogs).values({
      id: `audit-${randomBytes(12).toString("hex")}`,
      companyId,
      objectType: "USER", objectId: account.id, action: "PASSWORD_RESET_CLI",
      changes: [
        { field: "passwordHash", old: "[redacted]", new: "[redacted]" },
        { field: "sessionsRevoked", old: activeSessions.length, new: 0 },
      ],
      reason: "Reset lewat CLI pemulihan",
    });

    console.log(`Password untuk ${account.name} <${account.email}> sudah direset.`);
    console.log(`Company audit: ${membershipsOfUser[0]?.name} (${membershipsOfUser[0]?.slug})`);
    console.log(`Sesi dicabut: ${activeSessions.length}. Kunci login (bila ada) dibuka.`);
    if (!provided) {
      console.log(`\nPassword baru (tampil SEKALI, simpan sekarang):\n  ${password}\n`);
      console.log("Setelah masuk, segera ganti lewat menu akun → Ganti password.");
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
