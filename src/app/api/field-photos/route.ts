import { ApiError, requireUser } from "@/lib/auth";
import { todayJakarta } from "@/lib/format";
import { createFieldPhoto, listFieldPhotos } from "@/modules/field-photos/service";
import {
  MAX_PHOTO_BYTES, fieldPhotoFilterSchema, fieldPhotoUploadSchema,
} from "@/modules/field-photos/validation";
import { companyRoute } from "@/shared/auth/route";

export const runtime = "nodejs";

async function GETHandler(request: Request) {
  const user = await requireUser();
  const url = new URL(request.url);
  const filters = fieldPhotoFilterSchema.parse(Object.fromEntries(url.searchParams));
  const rows = await listFieldPhotos(user, filters);
  return Response.json({ data: rows, meta: { count: rows.length } });
}

async function POSTHandler(request: Request) {
  const user = await requireUser();
  const form = await request.formData().catch(() => {
    throw new ApiError("MULTIPART_REQUIRED", "Unggahan foto harus berupa multipart/form-data.", 415);
  });
  const field = (name: string) => {
    const value = form.get(name);
    return typeof value === "string" ? value : "";
  };
  const upload = form.get("file");
  if (!upload || typeof upload === "string" || typeof upload.arrayBuffer !== "function") {
    throw new ApiError("FILE_REQUIRED", "Pilih berkas foto pada field `file`.", 422);
  }
  if (upload.size > MAX_PHOTO_BYTES) {
    throw new ApiError("FILE_TOO_LARGE", "Ukuran foto maksimal 5 MB.", 413);
  }
  const input = fieldPhotoUploadSchema.parse({
    projectId: field("projectId"),
    category: field("category"),
    capturedAt: field("capturedAt") || todayJakarta(),
    description: field("description") || null,
    locationLabel: field("locationLabel") || null,
  });
  const buffer = Buffer.from(await upload.arrayBuffer());
  const result = await createFieldPhoto(user, input, {
    fileName: upload.name || "foto.jpg",
    mimeType: upload.type || "application/octet-stream",
    buffer,
  });
  return Response.json({ data: result }, { status: 201 });
}

export const GET = companyRoute(GETHandler);
export const POST = companyRoute(POSTHandler);
