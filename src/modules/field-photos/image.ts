import { createHash } from "node:crypto";
import sharp from "sharp";
import { ApiError } from "@/lib/auth";
import { MAX_PHOTO_BYTES, PHOTO_MIME_TYPES, type PhotoMime } from "@/modules/field-photos/validation";

/** Magic bytes, BUKAN sekadar `Content-Type` dari browser. */
export function sniffImageMime(buffer: Buffer): PhotoMime | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (buffer.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = buffer.subarray(8, 12).toString("ascii").toLowerCase();
    if (["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand)) return "image/heic";
  }
  return null;
}

function normalizeDeclaredMime(declared: string | null | undefined) {
  if (!declared) return null;
  const value = declared.toLowerCase().trim();
  if (value === "image/jpg") return "image/jpeg";
  return value;
}

export function validatePhotoBuffer(buffer: Buffer, declaredMime?: string | null): Exclude<PhotoMime, "image/heic"> {
  if (!buffer.length) throw new ApiError("EMPTY_FILE", "Berkas foto kosong.", 422);
  if (buffer.length > MAX_PHOTO_BYTES) throw new ApiError("FILE_TOO_LARGE", "Ukuran foto maksimal 5 MB.", 413);
  const sniffed = sniffImageMime(buffer);
  if (!sniffed) throw new ApiError("MAGIC_BYTES_INVALID", "Isi berkas bukan gambar yang dikenali.", 415);
  if (sniffed === "image/heic") {
    throw new ApiError("HEIC_NOT_SUPPORTED", "HEIC belum didukung. Simpan sebagai JPEG/PNG/WebP dari ponsel lalu unggah ulang.", 415);
  }
  const declared = normalizeDeclaredMime(declaredMime);
  if (declared && declared !== "application/octet-stream") {
    if (!PHOTO_MIME_TYPES.includes(declared as (typeof PHOTO_MIME_TYPES)[number])) {
      throw new ApiError("MIME_NOT_ALLOWED", "Tipe foto harus JPEG, PNG, atau WebP.", 415);
    }
    if (declared !== sniffed) {
      throw new ApiError("MIME_MISMATCH", "Tipe file tidak sesuai dengan isi berkas.", 415);
    }
  }
  return sniffed;
}

export type NormalizedPhoto = {
  buffer: Buffer;
  mimeType: "image/jpeg";
  sizeBytes: number;
  originalSizeBytes: number;
  width: number;
  height: number;
  sha256: string;
};

/** Rotasi EXIF, batasi sisi terpanjang 1800px, lalu normalisasi ke JPEG. */
export async function compressPhoto(buffer: Buffer): Promise<NormalizedPhoto> {
  const output = await sharp(buffer, { failOn: "error", limitInputPixels: 40_000_000 })
    .rotate()
    .resize({ width: 1800, height: 1800, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 78, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  const bytes = Buffer.from(output.data);
  if (bytes.length > MAX_PHOTO_BYTES) {
    throw new ApiError("PHOTO_TOO_LARGE_AFTER_COMPRESSION", "Foto masih melebihi 5 MB setelah kompresi.", 413);
  }
  return {
    buffer: bytes,
    mimeType: "image/jpeg",
    sizeBytes: bytes.length,
    originalSizeBytes: buffer.length,
    width: output.info.width,
    height: output.info.height,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
