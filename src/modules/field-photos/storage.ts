import { createHmac } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ApiError } from "@/lib/auth";
import { fileSigningSecret } from "@/shared/env";

export const STORAGE_URL_TTL_SECONDS = 300;

export type StoredFile = {
  id: string;
  storageProvider: string;
  storageBucket: string | null;
  storageKey: string;
  contentBase64: string | null;
  mimeType: string;
  sizeBytes: number;
  fileName: string;
};

type StorageConfig = {
  driver: "local" | "s3";
  bucket?: string;
  region?: string;
  endpoint?: string;
  forcePathStyle: boolean;
  credentials?: { accessKeyId: string; secretAccessKey: string };
};

export function getStorageConfig(): StorageConfig {
  const raw = (process.env.FILE_STORAGE_DRIVER || (process.env.NODE_ENV === "production" ? "s3" : "local")).toLowerCase();
  if (raw !== "local" && raw !== "s3") {
    throw new ApiError("STORAGE_DRIVER_INVALID", "FILE_STORAGE_DRIVER harus `local` atau `s3`.", 500);
  }
  if (raw === "local") {
    if (process.env.NODE_ENV === "production") {
      throw new ApiError("STORAGE_DRIVER_INVALID", "FILE_STORAGE_DRIVER=local tidak boleh dipakai di production (filesystem Vercel ephemeral).", 500);
    }
    return { driver: "local", forcePathStyle: false };
  }
  const missing = [
    "S3_BUCKET", "S3_REGION", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY",
  ].filter((key) => !process.env[key]);
  if (missing.length) {
    throw new ApiError("STORAGE_CONFIG", `Konfigurasi object storage belum lengkap: ${missing.join(", ")}.`, 500);
  }
  return {
    driver: "s3",
    bucket: process.env.S3_BUCKET,
    region: process.env.S3_REGION,
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
  };
}

function s3Client(config: StorageConfig) {
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint || undefined,
    forcePathStyle: config.forcePathStyle,
    credentials: config.credentials,
  });
}

function s3Bucket(file: StoredFile, config: StorageConfig) {
  const bucket = file.storageBucket || config.bucket;
  if (!bucket) throw new ApiError("STORAGE_BUCKET_MISSING", "Bucket file tidak diketahui.", 500);
  return bucket;
}

// Root statis memungkinkan Turbopack melakukan tracing hanya pada subfolder ini.
const LOCAL_ROOT = path.join(process.cwd(), ".local-storage");

function localFilePath(key: string) {
  const full = path.resolve(LOCAL_ROOT, key);
  if (full !== LOCAL_ROOT && !full.startsWith(LOCAL_ROOT + path.sep)) {
    throw new ApiError("STORAGE_PATH_INVALID", "Path storage tidak valid.", 500);
  }
  return full;
}

/**
 * Menyimpan objek apa pun (foto, DOCX, PDF) ke LOCAL/S3. Semua berkas privat:
 * `Cache-Control` pendek karena akses selalu lewat URL bertanda tangan.
 */
export async function putObject(
  buffer: Buffer,
  storageKey: string,
  contentType = "application/octet-stream",
): Promise<{ storageProvider: "LOCAL" | "S3"; storageBucket: string | null }> {
  const config = getStorageConfig();
  if (config.driver === "local") {
    const full = localFilePath(storageKey);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, buffer);
    return { storageProvider: "LOCAL", storageBucket: null };
  }
  const client = s3Client(config);
  await client.send(new PutObjectCommand({
    Bucket: config.bucket!,
    Key: storageKey,
    Body: buffer,
    ContentType: contentType,
    CacheControl: "private, max-age=300",
  }));
  return { storageProvider: "S3", storageBucket: config.bucket ?? null };
}

export async function putPhotoObject(buffer: Buffer, storageKey: string) {
  return putObject(buffer, storageKey, "image/jpeg");
}

/** Best-effort kompensasi bila insert DB gagal setelah object terunggah. */
export async function removeObject(
  storageKey: string,
  provider: "LOCAL" | "S3",
  bucket?: string | null,
): Promise<void> {
  try {
    const config = getStorageConfig();
    if (provider === "LOCAL") {
      await unlink(localFilePath(storageKey));
    } else {
      await s3Client(config).send(new DeleteObjectCommand({
        Bucket: bucket || config.bucket!,
        Key: storageKey,
      }));
    }
  } catch {
    // Jangan menutup error DB yang lebih penting; orphan dibersihkan operator.
  }
}

export async function getObjectBuffer(file: StoredFile): Promise<Buffer> {
  if (file.storageProvider === "DB") {
    if (!file.contentBase64) throw new ApiError("FILE_CONTENT_MISSING", "Isi file lama tidak tersedia.", 404);
    return Buffer.from(file.contentBase64, "base64");
  }
  const config = getStorageConfig();
  if (file.storageProvider === "LOCAL") {
    try {
      return await readFile(localFilePath(file.storageKey));
    } catch {
      throw new ApiError("FILE_NOT_FOUND", "Berkas tidak ditemukan di storage lokal.", 404);
    }
  }
  if (file.storageProvider === "S3") {
    try {
      const client = s3Client(config);
      const result = await client.send(new GetObjectCommand({
        Bucket: s3Bucket(file, config),
        Key: file.storageKey,
      }));
      const body = result.Body as unknown as { transformToByteArray?: () => Promise<Uint8Array> } | undefined;
      const bytes = body?.transformToByteArray ? await body.transformToByteArray() : undefined;
      if (!bytes) throw new Error("empty object body");
      return Buffer.from(bytes);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError("STORAGE_READ_FAILED", "Gagal membaca berkas dari object storage.", 502);
    }
  }
  throw new ApiError("STORAGE_PROVIDER_UNKNOWN", "Provider storage tidak dikenal.", 500);
}

/**
 * URL baca 5 menit. S3 memakai presigned GET URL; DB/LOCAL memakai signed
 * URL internal `/api/files/:id` yang diverifikasi HMAC + RLS di server.
 */
export async function getFileUrl(file: StoredFile, expires?: number): Promise<string> {
  const exp = expires ?? Math.floor(Date.now() / 1000) + STORAGE_URL_TTL_SECONDS;
  if (file.storageProvider === "S3") {
    const config = getStorageConfig();
    const client = s3Client(config);
    return getSignedUrl(client, new GetObjectCommand({
      Bucket: s3Bucket(file, config),
      Key: file.storageKey,
    }), { expiresIn: Math.max(1, exp - Math.floor(Date.now() / 1000)) });
  }
  const signature = createHmac("sha256", fileSigningSecret()).update(`${file.id}.${exp}`).digest("hex");
  return `/api/files/${file.id}?expires=${exp}&signature=${signature}`;
}
