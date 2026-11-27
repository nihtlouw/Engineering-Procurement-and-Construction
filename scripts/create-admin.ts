/**
 * Membuat (atau menautkan ulang) akun ADMIN dengan email Anda sendiri.
 *
 *   npm run db:create-admin -- --email aiengineer2027life@gmail.com --name "Nama Anda"
 *   npm run db:create-admin -- --email ... --name "..." --company "Ardaya EPC"
 *   npm run db:create-admin -- --email ... --name "..." --password 'Rahasia12345'
 *
 * Perilaku:
 * - company dibuat bila slug belum ada; bila ada, akun ditautkan sebagai ADMIN;
 * - user dibuat bila email belum ada. Bila email SUDAH ada (mis. akun demo
 *   `admin@ardaya.id` yang ingin dialihkan), gunakan `--relink-from <email lama>`:
 *   seluruh keanggotaan company dipindahkan ke email baru, lalu akun lama
 *   dinonaktifkan — datanya tidak dihapus sehingga audit tetap utuh;
 * - password: bila `--password` tidak diberikan, dibuat acak 20 karakter dan
 *   dicetak sekali. Alternatif tanpa password sama sekali: `--no-password`
 *   lalu pakai "Lupa password" di halaman masuk (butuh EMAIL_DRIVER).
 *
 * Aman dijalankan di production: skrip ini administratif, bukan seed demo.
 */
import { randomBytes, scryptSync } from "node:crypto";
import { config } from "dotenv";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { activityLogs, companies, memberships, sessions, users } from "../src/db/schema";

config({ path: ".env.local", quiet: true });

function randomPassword(length = 20) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  return Array.from(randomBytes(length), (byte) => alphabet[byte % alphabet.length]).join("");
}

function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

function slugify(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "company";
}

function parseArgs(argv: string[]) {
  const args: { email?: string; name?: string; company?: string; password?: string; noPassword: boolean; relinkFrom?: string } = { noPassword: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === "--no-password") args.noPassword = true;
    else if (token === "--email") { args.email = next; index += 1; }
    else if (token === "--name") { args.name = next; index += 1; }
    else if (token === "--company") { args.company = next; index += 1; }
    else if (token === "--password") { args.password = next; index += 1; }
    else if (token === "--relink-from") { args.relinkFrom = next; index += 1; }
    else if (token.startsWith("--email=")) args.email = token.slice(8);
    else if (token.startsWith("--name=")) args.name = token.slice(7);
    else if (token.startsWith("--company=")) args.company = token.slice(10);
    else if (token.startsWith("--password=")) args.password = token.slice(11);
    else if (token.startsWith("--relink-from=")) args.relinkFrom = token.slice(14);
  }
  return args;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL belum diisi.");
  const args = parseArgs(process.argv.slice(2));
  const email = args.email?.toLowerCase().trim();
  if (!email || !email.includes("@")) {
    throw new Error('Pemakaian: npm run db:create-admin -- --email <email> --name "Nama" [--company "Nama PT"] [--password <baru> | --no-password] [--relink-from <email lama>]');
  }
  const companyName = (args.company || "Ardaya EPC").trim();
  const password = args.noPassword ? null : (args.password ?? randomPassword());
  if (password) {
    if (password.length < 12) throw new Error("Password minimal 12 karakter.");
    if (!(/[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password))) {
      throw new Error("Password harus memuat huruf kecil, huruf besar, dan angka.");
    }
  }

  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle(pool);
  try {
    // 1. Company: cari berdasarkan slug, buat bila belum ada.
    const slug = slugify(companyName);
    let [company] = await db.select({ id: companies.id, name: companies.name, slug: companies.slug })
      .from(companies).where(eq(companies.slug, slug)).limit(1);
    if (!company) {
      [company] = await db.insert(companies).values({
        slug, name: companyName, legalName: companyName,
      }).returning({ id: companies.id, name: companies.name, slug: companies.slug });
      console.log(`Company dibuat: ${company.name} (${company.slug})`);
    } else {
      console.log(`Company dipakai: ${company.name} (${company.slug})`);
    }

    // 2. Akun: pakai yang ada, atau alihkan dari akun lama (--relink-from).
    let [account] = await db.select({ id: users.id, email: users.email, name: users.name })
      .from(users).where(eq(users.email, email)).limit(1);
    let relinkedFrom: string | null = null;

    if (!account && args.relinkFrom) {
      const oldEmail = args.relinkFrom.toLowerCase().trim();
      const [old] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.email, oldEmail)).limit(1);
      if (!old) throw new Error(`Akun lama ${oldEmail} tidak ditemukan.`);
      await db.update(users).set({ email, name: args.name?.trim() || undefined }).where(eq(users.id, old.id));
      account = { id: old.id, email, name: args.name?.trim() || "(nama lama)" };
      relinkedFrom = oldEmail;
      console.log(`Akun ${oldEmail} dialihkan ke ${email} (keanggotaan & audit tetap, id tidak berubah).`);
    } else if (!account) {
      const id = `usr-${randomBytes(12).toString("hex")}`;
      [account] = await db.insert(users).values({
        id, email,
        name: args.name?.trim() || email.split("@")[0],
        role: "ADMIN", title: "Admin Perusahaan",
        // Tanpa --password: hash acak yang tidak diketahui siapa pun. Akun tidak
        // dapat login sampai pemiliknya memakai "Lupa password" lewat email.
        passwordHash: hashPassword(password ?? randomBytes(32).toString("hex")),
      }).returning({ id: users.id, email: users.email, name: users.name });
      console.log(`Akun dibuat: ${account.email} (${account.id})`);
    } else {
      console.log(`Akun sudah ada: ${account.email} (${account.id})`);
    }

    // 3. Keanggotaan ADMIN pada company (idempoten).
    const [membership] = await db.select({ id: memberships.id, status: memberships.status, role: memberships.companyRole })
      .from(memberships)
      .where(and(eq(memberships.companyId, company.id), eq(memberships.userId, account.id)))
      .limit(1);
    if (membership) {
      await db.update(memberships).set({ companyRole: "ADMIN", status: "ACTIVE", updatedAt: new Date() }).where(eq(memberships.id, membership.id));
      console.log("Keanggotaan diperbarui menjadi ADMIN aktif.");
    } else {
      await db.insert(memberships).values({
        companyId: company.id, userId: account.id, companyRole: "ADMIN", status: "ACTIVE",
      });
      console.log("Keanggotaan ADMIN dibuat.");
    }

    // 4. Password (opsional) + reset penghitung/kunci + cabut sesi lama.
    if (password) {
      await db.update(users).set({
        passwordHash: hashPassword(password), failedLoginCount: 0, lockedUntil: null,
        isActive: true,
      }).where(eq(users.id, account.id));
      await db.delete(sessions).where(eq(sessions.userId, account.id));
    } else {
      await db.delete(sessions).where(eq(sessions.userId, account.id));
    }

    // 5. Audit (company_id NOT NULL → set GUC di koneksi ini).
    await pool.query("SELECT set_config('app.current_company_id', $1, false)", [company.id]);
    await db.insert(activityLogs).values({
      id: `audit-${randomBytes(12).toString("hex")}`,
      companyId: company.id,
      objectType: "USER", objectId: account.id, action: "ADMIN_ACCOUNT_PROVISIONED",
      changes: [
        { field: "email", old: relinkedFrom, new: email },
        { field: "companyRole", old: null, new: "ADMIN" },
      ],
      reason: "Provisioning admin lewat CLI",
    });

    console.log("\nSelesai.");
    console.log(`  Company : ${company.name} (${company.slug})`);
    console.log(`  Login   : ${email}`);
    if (password) {
      console.log(`  Password: ${password}`);
      console.log("\nPassword ini tampil SEKALI. Simpan di pengelola sandi, lalu ganti");
      console.log("lewat Pengaturan → Password akun setelah masuk.");
    } else {
      console.log("  Password: (tidak diset) — gunakan \"Lupa password\" di halaman masuk.");
      console.log(`\nPastikan EMAIL_DRIVER + RESEND_API_KEY + APP_BASE_URL terisi, atau minta`);
      console.log(`admin lain menjalankan: npm run db:reset-password -- --email ${email}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
