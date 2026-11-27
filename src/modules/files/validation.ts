/**
 * Validasi berkas generik (nota, PDF, XLSX, DOCX) berdasarkan **isi**, bukan
 * `Content-Type` dari browser. Melengkapi `field-photos/image.ts` yang khusus
 * foto: modul itu menormalkan gambar, modul ini hanya memverifikasi.
 *
 * Temuan audit #6: `files/route.ts` dulu menerima MIME kiriman klien apa adanya
 * dan menyimpan base64 di database. Sekarang isi diverifikasi magic bytes, MIME
 * yang disimpan adalah hasil deteksi, dan byte ditulis ke object storage.
 */

import { ApiError } from "@/lib/auth";

export const MAX_GENERIC_FILE_BYTES = 10 * 1024 * 1024;

export type GenericMime =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "application/pdf"
  | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Tipe yang diterima upload generik. DWG/HEIC sengaja tidak: tidak dapat diverifikasi isinya. */
export const GENERIC_MIME_TYPES: readonly GenericMime[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const PDF_MAGIC = Buffer.from("%PDF-", "ascii");

/**
 * Mendeteksi tipe dari magic bytes. OOXML (XLSX/DOCX) adalah ZIP, sehingga
 * dibedakan dengan membaca nama entri pertama di central directory — bukan
 * hanya ekstensi nama berkas.
 */
export function sniffGenericMime(buffer: Buffer): GenericMime | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (buffer.subarray(0, 5).equals(PDF_MAGIC)) return "application/pdf";
  if (buffer.subarray(0, 4).equals(ZIP_MAGIC)) {
    // Entri pertama pada OOXML adalah `[Content_Types].xml`, lalu `xl/` atau `word/`.
    const head = buffer.subarray(0, Math.min(buffer.length, 4096)).toString("latin1");
    if (head.includes("xl/workbook.xml") || head.includes("xl/")) {
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    }
    if (head.includes("word/document.xml") || head.includes("word/")) {
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    }
    return null;
  }
  return null;
}

export function normalizeDeclaredMime(declared: string | null | undefined) {
  if (!declared) return null;
  const value = declared.toLowerCase().trim();
  if (value === "image/jpg") return "image/jpeg";
  return value;
}

/**
 * Memverifikasi buffer + MIME deklarasi. Mengembalikan MIME **hasil deteksi**
 * yang harus disimpan; MIME kiriman klien hanya dipakai untuk mendeteksi
 * ketidakcocokan. `application/octet-stream` diperlakukan sebagai "tidak
 * mendeklarasikan tipe" agar unggahan dari perangkat lama tetap lolos selama
 * isinya dikenali.
 */
export function validateGenericFile(
  buffer: Buffer,
  declaredMime?: string | null,
  maxBytes = MAX_GENERIC_FILE_BYTES,
): GenericMime {
  if (!buffer.length) throw new ApiError("EMPTY_FILE", "Berkas kosong tidak dapat diunggah.", 422);
  if (buffer.length > maxBytes) {
    throw new ApiError("FILE_TOO_LARGE", `Ukuran berkas maksimal ${Math.round(maxBytes / 1024 / 1024)} MB.`, 413);
  }
  const sniffed = sniffGenericMime(buffer);
  if (!sniffed) {
    throw new ApiError("MAGIC_BYTES_INVALID", "Isi berkas tidak dikenali. Gunakan JPG, PNG, WebP, PDF, XLSX, atau DOCX.", 415);
  }
  const declared = normalizeDeclaredMime(declaredMime);
  if (declared && declared !== "application/octet-stream" && declared !== sniffed) {
    throw new ApiError("MIME_MISMATCH", "Tipe berkas tidak sesuai dengan isinya.", 415);
  }
  return sniffed;
}
