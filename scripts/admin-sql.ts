/**
 * Mencetak SQL provisioning admin yang siap ditempel ke SQL Editor Neon.
 *
 *   npm run db:admin-sql -- --email aiengineer2027life@gmail.com --name "Nama Anda" --print-password
 *
 * Kenapa: `npm run db:create-admin` membutuhkan DATABASE_URL dan terminal.
 * Bila Anda hanya punya akses ke dashboard Neon, SQL ini adalah padanan yang
 * setara (company + akun ADMIN + keanggotaan + audit), siap tempel.
 *
 * Berkas ini TIDAK menyentuh database. Output-nya ke stdout agar bisa
 * diarahkan: `npm run db:admin-sql -- … > admin.sql`.
 */
import { hashPasswordForStorage, verifyPasswordHash } from "./hash-password";

const TEMPLATE = "docs/runbook/sql/provision-admin.sql";

function parseArgs(argv: string[]) {
  const args: { email?: string; name?: string; company?: string; password?: string; printPassword: boolean } = { printPassword: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === "--print-password") args.printPassword = true;
    else if (token === "--email") { args.email = next; index += 1; }
    else if (token === "--name") { args.name = next; index += 1; }
    else if (token === "--company") { args.company = next; index += 1; }
    else if (token === "--password") { args.password = next; index += 1; }
  }
  return args;
}

function randomPassword(length = 20) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = Buffer.from(crypto.getRandomValues(new Uint8Array(length)));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function slugify(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "company";
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const email = args.email?.toLowerCase().trim();
  if (!email || !email.includes("@")) {
    console.error("Pemakaian: npm run db:admin-sql -- --email <email> [--name \"Nama\"] [--company \"Nama PT\"] [--password <baru>] [--print-password]");
    console.error("Output: SQL siap tempel ke SQL Editor Neon (tanpa # dan tanpa npm).");
    process.exitCode = 1;
    return;
  }
  const company = (args.company || "Ardaya EPC").trim();
  const name = (args.name || email.split("@")[0]).trim();
  const password = args.password ?? randomPassword();
  if (password.length < 12 || !(/[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password))) {
    console.error("Password minimal 12 karakter dan memuat huruf besar, huruf kecil, serta angka.");
    process.exitCode = 1;
    return;
  }
  const hash = hashPasswordForStorage(password);
  if (!verifyPasswordHash(password, hash)) {
    console.error("Hash gagal diverifikasi — jangan dipakai.");
    process.exitCode = 1;
    return;
  }

  const sql = [
    "-- Dihasilkan oleh `npm run db:admin-sql` — SQL siap tempel ke SQL Editor Neon.",
    `-- Email admin : ${email}`,
    `-- Company     : ${company} (${slugify(company)})`,
    "-- Jalankan SELURUH berkas ini sekaligus (satu transaksi).",
    "",
    "begin;",
    "",
    "insert into companies (slug, name, legal_name, email)",
    `values ('${slugify(company)}', '${company.replace(/'/g, "''")}', '${company.replace(/'/g, "''")}', '${email}')`,
    "on conflict (slug) do nothing;",
    "",
    "insert into users (id, name, email, role, title, password_hash)",
    "values (",
    "  'usr-admin-owner',",
    `  '${name.replace(/'/g, "''")}',`,
    `  '${email}',`,
    "  'ADMIN',",
    "  'Admin Perusahaan',",
    `  '${hash}'`,
    ")",
    "on conflict (email) do update",
    "  set password_hash = excluded.password_hash,",
    "      is_active = true;",
    "",
    "insert into memberships (company_id, user_id, company_role, status)",
    "select c.id, u.id, 'ADMIN', 'ACTIVE'",
    "  from companies c, users u",
    ` where c.slug = '${slugify(company)}'`,
    `   and u.email = '${email}'`,
    "on conflict (company_id, user_id) do update",
    "  set company_role = 'ADMIN', status = 'ACTIVE', updated_at = now();",
    "",
    "select set_config('app.current_company_id', (select id::text from companies where slug = '" + slugify(company) + "'), true);",
    "",
    "insert into activity_logs (object_type, object_id, project_id, action, changes, reason)",
    "values (",
    "  'USER',",
    `  (select id from users where email = '${email}'),`,
    "  null,",
    "  'ADMIN_ACCOUNT_PROVISIONED',",
    `  jsonb_build_array(jsonb_build_object('field', 'email', 'old', null, 'new', '${email}')),`,
    "  'Provisioning admin lewat SQL Editor'",
    ");",
    "",
    "commit;",
    "",
    "-- Verifikasi: satu baris, role ADMIN, panjang_hash = 161.",
    "select u.email, u.role, length(u.password_hash) as panjang_hash, m.company_role, m.status",
    "  from users u",
    "  join memberships m on m.user_id = u.id",
    ` where u.email = '${email}';`,
    "",
    `-- Template lengkap (dengan komentar) ada di ${TEMPLATE}.`,
    "",
  ].join("\n");

  // SQL ditulis ke stdout; password (bila diminta) ke stderr agar tidak ikut
  // tersimpan bila output diarahkan ke berkas.
  process.stdout.write(sql);
  if (args.printPassword) {
    process.stderr.write(`\nPassword untuk ${email}: ${password}\n(Simpan di pengelola sandi, lalu ganti lewat Pengaturan → Password akun.)\n`);
  } else {
    process.stderr.write(`\nPassword acak dibuat tetapi TIDAK dicetak. Ulangi dengan --print-password, atau set sendiri dengan --password.\n`);
  }
}

main();
