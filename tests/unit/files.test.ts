import { describe, expect, it } from "vitest";
import { sniffGenericMime, validateGenericFile, normalizeDeclaredMime, MAX_GENERIC_FILE_BYTES } from "@/modules/files/validation";

/* Berkas nyata hanya dibutuhkan pada beberapa byte pertama; helper ini membuat
 * buffer dengan header tertentu agar tes tidak bergantung pada file biner besar. */
const head = (...bytes: number[]) => Buffer.concat([Buffer.from(bytes), Buffer.alloc(32)]);
const zip = (entry: string) => {
  const body = Buffer.alloc(64);
  Buffer.from([0x50, 0x4b, 0x03, 0x04]).copy(body, 0);
  Buffer.from(entry, "latin1").copy(body, 8);
  return body;
};

describe("P0 #6 · deteksi isi berkas (bukan MIME klien)", () => {
  it("mengenali JPEG, PNG, WebP, dan PDF dari magic bytes", () => {
    expect(sniffGenericMime(head(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffGenericMime(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]))).toBe("image/png");
    const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(16)]);
    expect(sniffGenericMime(webp)).toBe("image/webp");
    expect(sniffGenericMime(Buffer.concat([Buffer.from("%PDF-1.7"), Buffer.alloc(16)]))).toBe("application/pdf");
  });

  it("membedakan XLSX dan DOCX meski keduanya ZIP", () => {
    expect(sniffGenericMime(zip("xl/workbook.xml"))).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(sniffGenericMime(zip("word/document.xml"))).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(sniffGenericMime(zip("notes/readme.txt"))).toBeNull();
  });

  it("menolak isi yang tidak dikenali (mis. skrip menyamar sebagai gambar)", () => {
    const html = Buffer.from("<html><script>alert(1)</script></html>");
    expect(sniffGenericMime(html)).toBeNull();
    expect(() => validateGenericFile(html, "image/png")).toThrow(/tidak dikenali/i);
  });

  it("MIME deklarasi yang tidak cocok dengan isi ditolak", () => {
    const jpeg = head(0xff, 0xd8, 0xff, 0xe0);
    expect(() => validateGenericFile(jpeg, "application/pdf")).toThrow(/tidak sesuai/i);
    expect(validateGenericFile(jpeg, "image/jpeg")).toBe("image/jpeg");
    // octet-stream = klien tidak mendeklarasikan tipe: tetap lolos bila isi valid.
    expect(validateGenericFile(jpeg, "application/octet-stream")).toBe("image/jpeg");
    expect(normalizeDeclaredMime("IMAGE/JPG")).toBe("image/jpeg");
  });

  it("menegakkan batas 10 MB dan berkas kosong", () => {
    expect(MAX_GENERIC_FILE_BYTES).toBe(10 * 1024 * 1024);
    expect(() => validateGenericFile(Buffer.alloc(0), "image/jpeg")).toThrow(/kosong/i);
    const big = Buffer.concat([head(0xff, 0xd8, 0xff, 0xe0), Buffer.alloc(MAX_GENERIC_FILE_BYTES)]);
    expect(() => validateGenericFile(big, "image/jpeg")).toThrow(/10 MB/);
  });
});
