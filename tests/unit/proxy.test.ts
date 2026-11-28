import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

/**
 * Guard tepi (src/proxy.ts). Tes ini mengunci dua perilaku:
 * 1. route publik tetap bisa diakses TANPA sesi;
 * 2. mutasi lintas situs DITOLAK — termasuk pada route publik.
 *
 * Butir 2 adalah regresi yang sebelumnya lolos: pemeriksaan CSRF berada SETELAH
 * `return NextResponse.next()` untuk route publik, sehingga `POST /api/auth/login`
 * dari situs lain diterima (login CSRF → korban masuk ke akun penyerang).
 */
function request(path: string, init: { method?: string; headers?: Record<string, string>; cookie?: string } = {}) {
  const headers = new Headers(init.headers ?? {});
  if (init.cookie) headers.set("cookie", `epc_session=${init.cookie}`);
  return new NextRequest(new URL(path, "https://epc.example.com"), {
    method: init.method ?? "GET",
    headers,
  });
}

describe("proxy · route publik", () => {
  it("mengizinkan GET tanpa sesi", () => {
    expect(proxy(request("/api/health")).status).toBe(200);
  });

  it("mengizinkan POST login dari origin yang sama", () => {
    const response = proxy(request("/api/auth/login", {
      method: "POST",
      headers: { origin: "https://epc.example.com", host: "epc.example.com", "sec-fetch-site": "same-origin" },
    }));
    expect(response.status).toBe(200);
  });

  it("mengizinkan POST reset password tanpa sesi (pengguna belum masuk)", () => {
    const response = proxy(request("/api/auth/forgot-password", {
      method: "POST",
      headers: { origin: "https://epc.example.com", host: "epc.example.com", "sec-fetch-site": "same-origin" },
    }));
    expect(response.status).toBe(200);
  });
});

describe("proxy · CSRF", () => {
  it("MENOLAK POST login lintas situs meski route-nya publik", () => {
    const response = proxy(request("/api/auth/login", {
      method: "POST",
      headers: { "sec-fetch-site": "cross-site", host: "epc.example.com" },
    }));
    expect(response.status).toBe(403);
  });

  it("menolak Origin yang berbeda dari Host", () => {
    const response = proxy(request("/api/auth/login", {
      method: "POST",
      headers: { origin: "https://penyerang.example", host: "epc.example.com" },
    }));
    expect(response.status).toBe(403);
  });

  it("menolak Origin yang tidak dapat diurai", () => {
    const response = proxy(request("/api/projects", {
      method: "POST",
      headers: { origin: "bukan url", host: "epc.example.com" },
      cookie: "sesi-uji",
    }));
    expect(response.status).toBe(403);
  });

  it("tidak memblokir GET lintas situs (navigasi biasa)", () => {
    const response = proxy(request("/api/health", { headers: { "sec-fetch-site": "cross-site" } }));
    expect(response.status).toBe(200);
  });
});

describe("proxy · route privat", () => {
  it("menolak tanpa cookie sesi", () => {
    expect(proxy(request("/api/projects")).status).toBe(401);
  });

  it("meneruskan bila cookie sesi ada", () => {
    expect(proxy(request("/api/projects", { cookie: "abc" })).status).toBe(200);
  });
});
