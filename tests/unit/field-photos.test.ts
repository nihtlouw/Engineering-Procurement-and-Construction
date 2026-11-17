import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PHOTO_MERGE_FIELD, buildBlocks, buildPhotoGalleryBlock, parsePhotoRows, withPhotoRefs,
  type DocumentBlock, type DocumentPhotoRef,
} from "@/lib/document-templates";
import { signFileToken } from "@/lib/auth";
import { filterFieldPhotos } from "@/modules/field-photos/filter";
import { compressPhoto, sniffImageMime, validatePhotoBuffer } from "@/modules/field-photos/image";
import {
  getFileUrl, getObjectBuffer, getStorageConfig, putPhotoObject, STORAGE_URL_TTL_SECONDS,
  type StoredFile,
} from "@/modules/field-photos/storage";
import { MAX_PHOTO_BYTES } from "@/modules/field-photos/validation";

const ENV_KEYS = [
  "FILE_STORAGE_DRIVER", "S3_BUCKET", "S3_REGION",
  "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_ENDPOINT", "S3_FORCE_PATH_STYLE",
] as const;
const envSnapshot = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
let storageKey = "";

beforeEach(() => {
  process.env.FILE_STORAGE_DRIVER = "local";
  for (const key of ENV_KEYS.slice(1)) delete process.env[key];
});

afterEach(async () => {
  for (const key of ENV_KEYS) {
    if (envSnapshot[key] === undefined) delete process.env[key];
    else process.env[key] = envSnapshot[key];
  }
  if (storageKey) await rm(path.join(process.cwd(), ".local-storage", storageKey), { force: true });
  storageKey = "";
});

const makeJpeg = () => sharp({
  create: { width: 8, height: 8, channels: 3, background: "#c0ffee" },
}).jpeg().toBuffer();

const storedFile = (overrides: Partial<StoredFile> = {}): StoredFile => ({
  id: "f-local",
  storageProvider: "LOCAL",
  storageBucket: null,
  storageKey: "private/field-photos/p1/f-local.jpg",
  contentBase64: null,
  mimeType: "image/jpeg",
  sizeBytes: 3,
  fileName: "foto.jpg",
  ...overrides,
});

describe("validasi & normalisasi foto S3", () => {
  it("mendeteksi magic bytes JPEG, PNG, WebP, HEIC", async () => {
    const jpeg = await makeJpeg();
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#fff" } }).png().toBuffer();
    const webp = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#fff" } }).webp().toBuffer();
    expect(sniffImageMime(jpeg)).toBe("image/jpeg");
    expect(sniffImageMime(png)).toBe("image/png");
    expect(sniffImageMime(webp)).toBe("image/webp");
    expect(sniffImageMime(Buffer.from("....ftypheic1234"))).toBe("image/heic");
    expect(sniffImageMime(Buffer.from("not an image"))).toBeNull();
  });

  it("menolak MIME yang tidak cocok, HEIC, file kosong, dan > 5 MB", async () => {
    const jpeg = await makeJpeg();
    expect(validatePhotoBuffer(jpeg, "image/jpeg")).toBe("image/jpeg");
    expect(() => validatePhotoBuffer(jpeg, "image/png")).toThrow(/tidak sesuai/);
    expect(() => validatePhotoBuffer(Buffer.from("....ftypheic1234"), "image/heic")).toThrow(/HEIC/);
    expect(() => validatePhotoBuffer(Buffer.alloc(0))).toThrow(/kosong/);
    expect(() => validatePhotoBuffer(Buffer.alloc(MAX_PHOTO_BYTES + 1, 0xff))).toThrow(/5 MB/);
  });

  it("sharp menghasilkan JPEG dengan metadata ukuran dan sha256", async () => {
    const png = await sharp({
      create: { width: 2000, height: 1000, channels: 3, background: "#123456" },
    }).png().toBuffer();
    const result = await compressPhoto(png);
    expect(result.mimeType).toBe("image/jpeg");
    expect(sniffImageMime(result.buffer)).toBe("image/jpeg");
    expect(result.width).toBeLessThanOrEqual(1800);
    expect(result.height).toBeLessThanOrEqual(1800);
    expect(result.sizeBytes).toBe(result.buffer.length);
    expect(result.originalSizeBytes).toBe(png.length);
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.sizeBytes).toBeLessThanOrEqual(MAX_PHOTO_BYTES);
  });
});

describe("filter tanggal & kategori", () => {
  const rows = [
    { id: "a", category: "BEFORE", capturedAt: "2026-11-01", isSelectedForReport: true },
    { id: "b", category: "PROCESS", capturedAt: "2026-11-02", isSelectedForReport: false },
    { id: "c", category: "AFTER", capturedAt: "2026-11-03", isSelectedForReport: true },
  ];

  it("rentang tanggal inklusif dan urut terbaru dulu", () => {
    const result = filterFieldPhotos(rows, { projectId: "p1", from: "2026-11-01", to: "2026-11-02", selectedOnly: false });
    expect(result.map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("kategori dan selectedOnly bekerja bersamaan", () => {
    expect(filterFieldPhotos(rows, { projectId: "p1", category: "PROCESS", selectedOnly: false }).map((r) => r.id)).toEqual(["b"]);
    expect(filterFieldPhotos(rows, { projectId: "p1", selectedOnly: true }).map((r) => r.id)).toEqual(["c", "a"]);
    expect(filterFieldPhotos(rows, { projectId: "p1", category: "AFTER", selectedOnly: false }).map((r) => r.id)).toEqual(["c"]);
  });
});

describe("kontrak {{#photos}} → blok PDF", () => {
  const refs: DocumentPhotoRef[] = [
    { id: "fp-3", fileId: "f-3", category: "AFTER", caption: "Selesai", capturedAt: "2026-11-03" },
    { id: "fp-1", fileId: "f-1", category: "BEFORE", caption: "Awal", capturedAt: "2026-11-01" },
    { id: "fp-2", fileId: "f-2", category: "PROCESS", caption: "Proses", capturedAt: "2026-11-02" },
  ];

  it("parsePhotoRows aman terhadap JSON rusak dan tipe salah", () => {
    expect(parsePhotoRows("bukan json")).toEqual([]);
    expect(parsePhotoRows(JSON.stringify([{ fileId: "" }, { fileId: "f-1", category: "BEFORE" }]))).toHaveLength(1);
  });

  it("buildBlocks menyisipkan galeri BEFORE/PROCESS/AFTER pada laporan progres", () => {
    const blocks = buildBlocks("PROGRESS_REPORT", {
      projectCode: "PRJ-1", projectTitle: "Proyek", clientLegalName: "PT Klien",
      [PHOTO_MERGE_FIELD]: JSON.stringify(refs),
    });
    const gallery = blocks.find((block) => block.type === "photoGallery");
    expect(gallery).toBeDefined();
    expect(gallery?.type === "photoGallery" && gallery.photos.map((p) => p.category)).toEqual(["BEFORE", "PROCESS", "AFTER"]);
    expect(blocks.findIndex((b) => b.type === "photoGallery")).toBeLessThan(blocks.findIndex((b) => b.type === "signature"));
  });

  it("withPhotoRefs menggantikan galeri lama dan menambahkan galeri sebelum tanda tangan", () => {
    const old: DocumentBlock[] = [
      { type: "paragraph", text: "Isi" },
      { type: "photoGallery", heading: "LAMA", photos: [refs[0]] },
      { type: "signature", parties: [] },
    ];
    const replaced = withPhotoRefs(old, refs);
    const gallery = replaced.find((block) => block.type === "photoGallery");
    expect(gallery?.type === "photoGallery" && gallery.photos.map((p) => p.category)).toEqual(["BEFORE", "PROCESS", "AFTER"]);
    const bare: DocumentBlock[] = [{ type: "paragraph", text: "Isi" }, { type: "signature", parties: [] }];
    const inserted = withPhotoRefs(bare, refs);
    expect(inserted.some((block) => block.type === "photoGallery")).toBe(true);
    expect(inserted.findIndex((b) => b.type === "photoGallery")).toBeLessThan(inserted.findIndex((b) => b.type === "signature"));
    expect(buildPhotoGalleryBlock([])).toBeNull();
  });
});

describe("storage adapter", () => {
  it("LOCAL menulis bytes, membaca ulang, dan membuat signed URL 5 menit", async () => {
    expect(getStorageConfig().driver).toBe("local");
    const jpeg = await makeJpeg();
    storageKey = `private/field-photos/tests/${randomUUID()}.jpg`;
    const stored = await putPhotoObject(jpeg, storageKey);
    expect(stored).toEqual({ storageProvider: "LOCAL", storageBucket: null });
    const file = storedFile({ sizeBytes: jpeg.length, storageKey, id: "f-local" });
    expect(await getObjectBuffer(file)).toEqual(jpeg);
    const expires = Math.floor(Date.now() / 1000) + STORAGE_URL_TTL_SECONDS;
    const url = await getFileUrl(file, expires);
    expect(url).toBe(`/api/files/f-local?expires=${expires}&signature=${signFileToken("f-local", expires)}`);
  });

  it("file lama provider DB tetap dibaca dari base64 tanpa konfigurasi S3", async () => {
    const jpeg = await makeJpeg();
    const buffer = await getObjectBuffer(storedFile({
      id: "f-db", storageProvider: "DB", contentBase64: jpeg.toString("base64"), sizeBytes: jpeg.length,
    }));
    expect(buffer).toEqual(jpeg);
  });

  it("konfigurasi S3 tanpa kredensial gagal jelas", () => {
    process.env.FILE_STORAGE_DRIVER = "s3";
    expect(() => getStorageConfig()).toThrow(/Konfigurasi object storage belum lengkap/);
  });
});
