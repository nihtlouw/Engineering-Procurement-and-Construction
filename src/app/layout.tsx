import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = { title: { default: "Ardaya EPC — Project Control", template: "%s · Ardaya EPC" }, description: "Sistem manajemen proyek kontraktor EPC elektro: biaya, pengadaan, progres, tagihan, dan serah terima." };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#17211c" };
export default function RootLayout({ children }: { children: ReactNode }) { return <html lang="id"><body>{children}</body></html>; }
