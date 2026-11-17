import { NextResponse, type NextRequest } from "next/server";

/**
 * Guard tepi (defense-in-depth). Ini BUKAN pengganti requireUser():
 * middleware berjalan di Edge tanpa akses DB, jadi hanya memeriksa keberadaan
 * cookie, Origin, dan Sec-Fetch-Site. Otorisasi sebenarnya tetap di handler
 * lewat requireUser() + assertPermission() + RLS.
 */
const PUBLIC_PATHS = [
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/accept-invite",
  "/api/health",
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  // Pertahanan CSRF dasar untuk seluruh mutasi.
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

  if (!request.cookies.has("epc_session")) {
    return NextResponse.json(
      { code: "UNAUTHENTICATED", message: "Sesi tidak ditemukan. Silakan masuk kembali." },
      { status: 401 },
    );
  }
  return NextResponse.next();
}

export const config = { matcher: ["/api/:path*"] };
