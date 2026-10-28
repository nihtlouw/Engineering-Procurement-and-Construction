import Decimal from "decimal.js";

export const D = (value: Decimal.Value | null | undefined) => new Decimal(value ?? 0);
export const money = (value: Decimal.Value | null | undefined) => D(value).toDecimalPlaces(2).toFixed(2);

export function formatIDR(value: string | number | null | undefined, compact = false) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return "Rp 0";
  if (compact && Math.abs(numeric) >= 1_000_000_000) return `Rp ${(numeric / 1_000_000_000).toLocaleString("id-ID", { maximumFractionDigits: 2 })} M`;
  if (compact && Math.abs(numeric) >= 1_000_000) return `Rp ${(numeric / 1_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} jt`;
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(numeric);
}

export function formatDate(value: string | Date | null | undefined, withYear = true) {
  if (!value) return "—";
  const date = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00+07:00`) : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", ...(withYear ? { year: "numeric" } : {}), timeZone: "Asia/Jakarta" }).format(date);
}

export function todayJakarta() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function terbilang(value: Decimal.Value): string {
  const n = D(value).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  if (n.isNegative()) return `Minus ${terbilang(n.abs())}`;
  const satuan = ["", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan", "sepuluh", "sebelas"];
  const spell = (x: Decimal): string => {
    if (x.lt(12)) return satuan[x.toNumber()];
    if (x.lt(20)) return `${spell(x.minus(10))} belas`;
    if (x.lt(100)) return `${spell(x.dividedToIntegerBy(10))} puluh ${spell(x.mod(10))}`.trim();
    if (x.lt(200)) return `seratus ${spell(x.minus(100))}`.trim();
    if (x.lt(1000)) return `${spell(x.dividedToIntegerBy(100))} ratus ${spell(x.mod(100))}`.trim();
    if (x.lt(2000)) return `seribu ${spell(x.minus(1000))}`.trim();
    if (x.lt(1_000_000)) return `${spell(x.dividedToIntegerBy(1000))} ribu ${spell(x.mod(1000))}`.trim();
    if (x.lt(1_000_000_000)) return `${spell(x.dividedToIntegerBy(1_000_000))} juta ${spell(x.mod(1_000_000))}`.trim();
    if (x.lt(1_000_000_000_000)) return `${spell(x.dividedToIntegerBy(1_000_000_000))} miliar ${spell(x.mod(1_000_000_000))}`.trim();
    return `${spell(x.dividedToIntegerBy(1_000_000_000_000))} triliun ${spell(x.mod(1_000_000_000_000))}`.trim();
  };
  return n.isZero() ? "Nol rupiah" : `${spell(n)} rupiah`.replace(/\s+/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export function parseIndonesianNumber(raw: string): string | null {
  let value = raw.replace(/rp/gi, "").replace(/\s/g, "").replace(/[^\d,.-]/g, "");
  if (!value || !/\d/.test(value)) return null;
  const lastComma = value.lastIndexOf(",");
  const lastDot = value.lastIndexOf(".");
  if (lastComma > lastDot) value = value.replace(/\./g, "").replace(",", ".");
  else if (lastDot > -1 && lastComma === -1) {
    const decimals = value.length - lastDot - 1;
    if (decimals === 3) value = value.replace(/\./g, "");
  } else value = value.replace(/,/g, "");
  try { return money(value); } catch { return null; }
}
