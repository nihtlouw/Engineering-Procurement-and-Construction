/**
 * Hashing password terpusat untuk SELURUH aplikasi.
 *
 * Kenapa modul terpisah dari `src/lib/auth.ts`:
 * 1. `src/lib/auth.ts` meng-import `next/headers`, sehingga tidak bisa dipakai
 *    oleh skrip CLI, seed, atau tes tanpa runtime Next. Modul ini hanya
 *    memakai `node:crypto`.
 * 2. Parameter scrypt perlu bisa naik di masa depan. Hash LAMA tidak menyimpan
 *    parameternya (hanya `salt:hash`), sehingga parameter tidak dapat
 *    diketahui dari nilai yang tersimpan. Format baru diberi versi eksplisit.
 *
 * Format yang didukung:
 * - BARU  : `scrypt$N=32768,r=8,p=1$<salt hex>$<key hex>`
 * - LEGACY: `<salt hex>:<key hex>`  → N=16384, r=8, p=1 (default Node)
 *
 * Hash legacy tetap bisa diverifikasi (pengguna lama tidak boleh terkunci),
 * dan otomatis dinaikkan ke format baru setelah login berhasil
 * (`needsRehash`). Tanpa jalur ini, seluruh akun akan memakai parameter lemah
 * selamanya karena hash hanya ditulis saat password diubah.
 */
import { randomBytes, scrypt, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * `promisify(scrypt)` bertipe hanya 3 argumen, padahal opsi (N/r/p/maxmem) perlu
 * ikut. Bungkus sendiri agar tipenya benar dan opsi benar-benar sampai.
 */
function scryptAsync(
  password: string, salt: string, keyLength: number, options: { N: number; r: number; p: number; maxmem: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, derived) => {
      if (error) reject(error);
      else resolve(derived);
    });
  });
}

const KEY_LENGTH = 64;
const SALT_BYTES = 16;

/**
 * Parameter aktif. N=2^15 dipilih dari pengukuran, bukan salinan dokumentasi:
 * - N=16384 (default lama) → ~41 ms/verifikasi di mesin build ini;
 * - N=32768               → ~88 ms/verifikasi.
 * OWASP menyarankan N=2^17 untuk scrypt, tetapi ~350 ms per login terlalu mahal
 * untuk fungsi serverless (audit #7: brute force vs. availability). N=32768
 * menaikkan biaya penyerang 2× tanpa membuat login terasa lambat.
 * Angka ini WAJIB ditinjau ulang bila ada pengukuran produksi.
 */
export const SCRYPT_PARAMS = { N: 32768, r: 8, p: 1 } as const;
/** maxmem harus eksplisit: batas default Node (32 MB) lebih kecil dari kebutuhan N=32768. */
const MAXMEM = 128 * 1024 * 1024;
/** Parameter hash legacy (default `scryptSync` tanpa opsi). */
const LEGACY_PARAMS = { N: 16384, r: 8, p: 1 } as const;

export type ScryptParams = { N: number; r: number; p: number };

function encode(params: ScryptParams, salt: string, key: Buffer): string {
  const tag = `N=${params.N},r=${params.r},p=${params.p}`;
  return `scrypt$${tag}$${salt}$${key.toString("hex")}`;
}

/**
 * Membaca hash tersimpan. Mengembalikan `null` bila formatnya tidak dikenali —
 * pemanggil harus memperlakukannya sebagai "password tidak cocok", bukan crash.
 */
export function parseStoredHash(stored: string): { params: ScryptParams; salt: string; key: Buffer } | null {
  if (!stored) return null;
  if (stored.startsWith("scrypt$")) {
    const [, tag, salt, key] = stored.split("$");
    if (!tag || !salt || !key) return null;
    const values = Object.fromEntries(tag.split(",").map((pair) => pair.split("=")));
    const N = Number(values.N);
    const r = Number(values.r);
    const p = Number(values.p);
    if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return null;
    // Batas atas mencegah database yang dirusak membuat server menghitung
    // scrypt raksasa (N=2^30 akan menghabiskan CPU/RAM).
    if (N < 1024 || N > 2 ** 18 || r < 1 || r > 32 || p < 1 || p > 8) return null;
    const buffer = Buffer.from(key, "hex");
    if (buffer.length !== KEY_LENGTH) return null;
    return { params: { N, r, p }, salt, key: buffer };
  }
  const [salt, key] = stored.split(":");
  if (!salt || !key) return null;
  const buffer = Buffer.from(key, "hex");
  if (buffer.length !== KEY_LENGTH) return null;
  return { params: { ...LEGACY_PARAMS }, salt, key: buffer };
}

/** Hash baru: selalu memakai parameter aktif dan format berversi. */
export async function hashPasswordAsync(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES).toString("hex");
  const key = await scryptAsync(password, salt, KEY_LENGTH, { ...SCRYPT_PARAMS, maxmem: MAXMEM });
  return encode(SCRYPT_PARAMS, salt, key);
}

/**
 * Verifikasi. Sengaja ASINKRON: `scryptSync` memblokir event loop ~41–88 ms per
 * percobaan login. Terukur bahwa 8 permintaan bersamaan (batas rate limit
 * per akun) akan menahan seluruh request lain di instance itu hampir 700 ms —
 * penyerang dapat memakainya untuk memperlambat pengguna sah tanpa satu pun
 * password benar (audit #7).
 */
export async function verifyPasswordAsync(password: string, stored: string): Promise<boolean> {
  const parsed = parseStoredHash(stored);
  if (!parsed) return false;
  const candidate = await scryptAsync(password, parsed.salt, KEY_LENGTH, { ...parsed.params, maxmem: MAXMEM });
  return candidate.length === parsed.key.length && timingSafeEqual(candidate, parsed.key);
}

/**
 * Haruskah hash ditulis ulang setelah login berhasil?
 * - format legacy (tanpa versi) → selalu, ke parameter aktif;
 * - parameter tersimpan berbeda dari parameter aktif → naikkan.
 */
export function needsRehash(stored: string): boolean {
  const parsed = parseStoredHash(stored);
  if (!parsed) return true;
  if (!stored.startsWith("scrypt$")) return true;
  return parsed.params.N !== SCRYPT_PARAMS.N
    || parsed.params.r !== SCRYPT_PARAMS.r
    || parsed.params.p !== SCRYPT_PARAMS.p;
}

/**
 * Verifikasi SINKRON — hanya untuk CLI sekali jalan dan tes. Jalur request WAJIB
 * memakai `verifyPasswordAsync` (lihat alasannya di fungsi itu).
 */
export function verifyPasswordSync(password: string, stored: string): boolean {
  const parsed = parseStoredHash(stored);
  if (!parsed) return false;
  const candidate = scryptSync(password, parsed.salt, KEY_LENGTH, { ...parsed.params, maxmem: MAXMEM });
  return candidate.length === parsed.key.length && timingSafeEqual(candidate, parsed.key);
}

/**
 * Versi SINKRON — hanya untuk skrip CLI sekali jalan (seed/migrasi) dan tes.
 * JANGAN dipakai di jalur request; gunakan `hashPasswordAsync`.
 */
export function hashPasswordSync(password: string): string {
  const salt = randomBytes(SALT_BYTES).toString("hex");
  const key = scryptSync(password, salt, KEY_LENGTH, { ...SCRYPT_PARAMS, maxmem: MAXMEM });
  return encode(SCRYPT_PARAMS, salt, key);
}
