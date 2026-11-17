import { PHOTO_CATEGORY_ORDER, type FieldPhotoFilter } from "@/modules/field-photos/validation";

type FilterablePhoto = {
  category: string;
  capturedAt: string;
  isSelectedForReport: boolean;
};

/** Murni, dipakai UI & API GET sehingga filter tanggal/kategori konsisten. */
export function filterFieldPhotos<T extends FilterablePhoto>(rows: T[], filters: FieldPhotoFilter): T[] {
  return rows
    .filter((row) => {
      if (filters.from && row.capturedAt < filters.from) return false;
      if (filters.to && row.capturedAt > filters.to) return false;
      if (filters.category && row.category !== filters.category) return false;
      if (filters.selectedOnly && !row.isSelectedForReport) return false;
      return true;
    })
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt)
      || (PHOTO_CATEGORY_ORDER[a.category] ?? 99) - (PHOTO_CATEGORY_ORDER[b.category] ?? 99));
}
