import { NextResponse, type NextRequest } from "next/server";

/**
 * Guard tepi (defense-in-depth). Ini BUKAN pengganti requireUser():
 * proxy berjalan sebelum route handler tanpa akses DB, jadi hanya memeriksa
 * keberadaan cookie, Origin, dan Sec-Fetch-Site. Otorisasi sebenarnya tetap di
 * handler lewat requireUser() + assertPermission() + RLS.
 *
 * Sejak Next.js 16.4 konvensi `middleware.ts` deprecated → `proxy.ts`
 * (nama fungsi: `proxy`, bukan `middleware`).
 */
const PUBLIC_PATHS = [
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/accept-invite",
  // Reset password: pengguna BELUM punya sesi saat memakai kedua route ini.
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
  "/api/health",
];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  /* Pertahanan CSRF untuk SELURUH mutasi — termasuk route publik.
     Sebelumnya pemeriksaan ini dilewati untuk route publik (login, reset,
     accept-invite). Akibatnya `POST /api/auth/login` lintas situs tetap diterima:
     penyerang dapat memaksa korban masuk ke AKUN PENYERANG (login CSRF) sehingga
     korban mengunggah data ke tenant yang salah tanpa sadar. Pemeriksaan origin
     tidak membutuhkan sesi, jadi tidak ada alasan melewatinya. */
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const site = request.headers.get("sec-fetch-site");
    if (site === "cross-site") {
      return NextResponse.json({ code: "CSRF_BLOCKED", message: "Permintaan lintas situs ditolak." }, { status: 403 });
    }
    const origin = request.headers.get("origin");
    const host = request.headers.get("host");
    if (origin && host) {
      try {
        if (new URL(origin).host !== host) {
          return NextResponse.json({ code: "CSRF_BLOCKED", message: "Origin tidak sesuai." }, { status: 403 });
        }
      } catch {
        return NextResponse.json({ code: "CSRF_BLOCKED", message: "Origin tidak valid." }, { status: 403 });
      }
    }
  }

  if (isPublic) return NextResponse.next();

  if (!request.cookies.has("epc_session")) {
    return NextResponse.json(
      { code: "UNAUTHENTICATED", message: "Sesi tidak ditemukan. Silakan masuk kembali." },
      { status: 401 },
    );
  }
  return NextResponse.next();
}

export const config = { matcher: ["/api/:path*"] };
