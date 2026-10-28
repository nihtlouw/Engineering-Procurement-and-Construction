import { eq } from "drizzle-orm";
import { z } from "zod";
import { recognize } from "tesseract.js";
import { db } from "@/db";
import { expenses, fileObjects } from "@/db/schema";
import { errorResponse, requireUser } from "@/lib/auth";
import { parseIndonesianNumber } from "@/lib/format";

export const maxDuration = 60;
const schema = z.object({ fileId: z.string() });
export async function POST(request: Request) {
  try {
    const user = await requireUser(); const { fileId } = schema.parse(await request.json());
    const [file] = await db.select().from(fileObjects).where(eq(fileObjects.id, fileId)).limit(1);
    if (!file || (file.uploadedById !== user.id && user.role !== "ADMIN")) return Response.json({ code: "FILE_NOT_FOUND", message: "File OCR tidak ditemukan." }, { status: 404 });
    if (!file.mimeType.startsWith("image/")) return Response.json({ code: "OCR_IMAGE_REQUIRED", message: "OCR lokal saat ini menerima gambar nota. PDF dapat diisi manual." }, { status: 415 });
    const [linked] = await db.select().from(expenses).where(eq(expenses.receiptFileId, fileId)).limit(1);
    if (linked) await db.update(expenses).set({ ocrStatus: "PROCESSING" }).where(eq(expenses.id, linked.id));
    try {
      const result = await recognize(Buffer.from(file.contentBase64, "base64"), "eng");
      const text = result.data.text; const textLines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const findAmount = (patterns: RegExp) => {
        const line = textLines.find((l) => patterns.test(l));
        const match = line?.match(/(?:rp\s*)?[\d.,]+/gi)?.filter((v) => /\d/.test(v)).pop();
        return match ? parseIndonesianNumber(match) : null;
      };
      const total = findAmount(/grand\s*total|total|jumlah|amount due/i);
      const tax = findAmount(/ppn|tax|pajak/i); const discount = findAmount(/discount|diskon|potongan/i);
      const dateLine = text.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})\b/);
      let transactionDate: string | null = null;
      if (dateLine) { const year = dateLine[3].length === 2 ? `20${dateLine[3]}` : dateLine[3]; transactionDate = `${year}-${dateLine[2].padStart(2, "0")}-${dateLine[1].padStart(2, "0")}`; }
      const receiptMatch = text.match(/(?:receipt|invoice|nota|no\.?)\s*[:#]?\s*([A-Z0-9][A-Z0-9/_-]{3,})/i);
      const suggestions = {
        merchantName: textLines[0]?.slice(0, 100) || null, receiptNumber: receiptMatch?.[1] || null, transactionDate,
        totalAmount: total, ppnAmount: tax || "0.00", discountAmount: discount || "0.00",
        lines: textLines.filter((l) => !/total|ppn|tax|tunai|cash|change|kembali/i.test(l) && /[\d.,]{3,}/.test(l)).slice(0, 12).map((l) => {
          const match = l.match(/(?:rp\s*)?[\d.,]+/gi)?.filter((v) => /\d/.test(v)).pop();
          return { description: l.replace(/(?:rp\s*)?[\d.,]+/gi, "").trim() || l, quantity: "1", unitCode: "Ls", unitPrice: match ? parseIndonesianNumber(match) : null };
        }),
      };
      const raw = { text, confidence: result.data.confidence / 100, suggestions, provider: "tesseract.js-local" };
      if (linked) await db.update(expenses).set({ ocrStatus: "DONE", ocrRawResult: raw, ocrConfidence: String(result.data.confidence / 100) }).where(eq(expenses.id, linked.id));
      return Response.json({ data: raw });
    } catch (ocrError) {
      if (linked) await db.update(expenses).set({ ocrStatus: "FAILED" }).where(eq(expenses.id, linked.id));
      console.error("OCR failed", ocrError);
      return Response.json({ code: "OCR_FAILED", message: "OCR tidak dapat membaca gambar ini. Silakan lanjutkan dengan input manual; tidak ada data yang diubah otomatis." }, { status: 422 });
    }
  } catch (error) { return errorResponse(error); }
}
