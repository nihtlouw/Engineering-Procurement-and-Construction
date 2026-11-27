/**
 * Pengiriman email transaksional (undangan, reset password).
 *
 * Tiga driver, dipilih lewat `EMAIL_DRIVER`:
 * - `resend`  : production. HTTP API Resend, tanpa dependensi SDK tambahan.
 * - `console` : development/preview. Email TIDAK dikirim, isinya dicetak ke log
 *               server agar pengembang dapat menyalin tautan reset. Ini bukan
 *               kebocoran: driver ini ditolak di production.
 * - `none`    : default. Tidak mengirim apa pun dan melaporkan `delivered: false`
 *               supaya pemanggil dapat memberi instruksi alternatif ke pengguna.
 *
 * Sengaja tidak memakai pustaka SMTP: satu HTTP call lebih mudah diaudit dan
 * tidak menambah permukaan dependensi. Bila nanti perlu SMTP/attachment,
 * ganti implementasi di satu berkas ini.
 */

export type EmailDriver = "resend" | "console" | "none";

export type EmailMessage = {
  to: string;
  subject: string;
  /** Teks polos: selalu ada, dipakai sebagai fallback klien email. */
  text: string;
  /** HTML opsional; harus aman (tanpa input pengguna yang tidak di-escape). */
  html?: string;
};

export type EmailResult =
  | { delivered: true; driver: Exclude<EmailDriver, "none">; id?: string }
  | { delivered: false; driver: EmailDriver; reason: string };

export function emailDriver(): EmailDriver {
  const raw = (process.env.EMAIL_DRIVER || "").toLowerCase().trim();
  if (raw === "resend" || raw === "console" || raw === "none") return raw;
  // Tanpa konfigurasi eksplisit: console di development, none di production.
  // Tidak pernah menebak "resend" karena itu akan gagal karena API key kosong.
  return process.env.NODE_ENV === "production" ? "none" : "console";
}

export function isEmailConfigured(): boolean {
  const driver = emailDriver();
  if (driver === "resend") return Boolean(process.env.RESEND_API_KEY);
  return driver === "console";
}

/** Alamat pengirim; wajib domain terverifikasi bila memakai Resend. */
function fromAddress() {
  return process.env.EMAIL_FROM || "Ardaya EPC <no-reply@localhost>";
}

export async function sendEmail(message: EmailMessage): Promise<EmailResult> {
  const driver = emailDriver();

  if (driver === "none") {
    return { delivered: false, driver, reason: "Pengiriman email belum dikonfigurasi (EMAIL_DRIVER)." };
  }

  if (driver === "console") {
    if (process.env.NODE_ENV === "production") {
      // Jangan pernah mencetak tautan reset ke log production.
      return { delivered: false, driver, reason: "Driver console ditolak di production." };
    }
    console.info(`\n[email:console] ke=${message.to}\n  subjek: ${message.subject}\n${message.text.replace(/^/gm, "  ")}\n`);
    return { delivered: true, driver };
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { delivered: false, driver, reason: "RESEND_API_KEY belum diisi." };
  }
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: fromAddress(),
        to: [message.to],
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      }),
    });
    if (!response.ok) {
      // Body error tidak memuat kredensial; aman dilog sebatas status + pesan.
      const detail = await response.text().catch(() => "");
      console.error("[email] gagal kirim", response.status, detail.slice(0, 300));
      return { delivered: false, driver, reason: `Penyedia email menolak permintaan (${response.status}).` };
    }
    const body = (await response.json().catch(() => ({}))) as { id?: string };
    return { delivered: true, driver, id: body.id };
  } catch (error) {
    console.error("[email] error jaringan", error instanceof Error ? error.message : error);
    return { delivered: false, driver, reason: "Gagal menghubungi penyedia email." };
  }
}

/** Escape minimal untuk menyisipkan nilai ke HTML email. */
const esc = (value: string) => value
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const shell = (title: string, body: string) => `<!doctype html>
<html lang="id"><body style="margin:0;background:#f4f5f3;padding:24px;font-family:ui-sans-serif,system-ui,'Segoe UI',sans-serif;color:#17211c">
  <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e2e5e0;border-radius:14px;padding:26px">
    <p style="margin:0 0 4px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6b7770">Ardaya EPC</p>
    <h1 style="margin:0 0 14px;font-size:18px;line-height:1.35">${esc(title)}</h1>
    ${body}
    <p style="margin:22px 0 0;border-top:1px solid #eceeea;padding-top:12px;font-size:11px;line-height:1.6;color:#6b7770">
      Email otomatis. Jangan membalas pesan ini; bila Anda tidak merasa meminta perubahan apa pun, abaikan email dan beri tahu admin perusahaan.
    </p>
  </div>
</body></html>`;

const button = (href: string, label: string) =>
  `<p style="margin:18px 0"><a href="${esc(href)}" style="display:inline-block;background:#17211c;color:#c6f24e;text-decoration:none;font-weight:600;font-size:13px;padding:11px 18px;border-radius:10px">${esc(label)}</a></p>
   <p style="margin:0;font-size:11.5px;line-height:1.6;color:#6b7770;word-break:break-all">Bila tombol tidak berfungsi, salin tautan ini:<br>${esc(href)}</p>`;

export function passwordResetEmail(input: { name: string; link: string; expiresMinutes: number }): EmailMessage {
  const subject = "Atur ulang password Ardaya EPC";
  const text = [
    `Halo ${input.name},`,
    "",
    "Kami menerima permintaan untuk mengatur ulang password akun Ardaya EPC Anda.",
    `Buka tautan berikut (berlaku ${input.expiresMinutes} menit dan hanya dapat dipakai sekali):`,
    input.link,
    "",
    "Setelah password diubah, semua sesi lama otomatis dikeluarkan.",
    "Bila Anda tidak meminta ini, abaikan email ini — password Anda tidak berubah.",
  ].join("\n");
  const html = shell(`Atur ulang password`, `
    <p style="margin:0;font-size:13px;line-height:1.7">Halo ${esc(input.name)},</p>
    <p style="margin:10px 0 0;font-size:13px;line-height:1.7">Kami menerima permintaan untuk mengatur ulang password akun Ardaya EPC Anda. Tautan berlaku <strong>${input.expiresMinutes} menit</strong> dan hanya dapat dipakai sekali.</p>
    ${button(input.link, "Atur password baru")}
    <p style="margin:14px 0 0;font-size:12px;line-height:1.7;color:#3d4a43">Setelah password diubah, semua sesi lama otomatis dikeluarkan.</p>
    <p style="margin:6px 0 0;font-size:12px;line-height:1.7;color:#6b7770">Bila Anda tidak meminta ini, abaikan email ini — password Anda tidak berubah.</p>`);
  return { to: "", subject, text, html };
}

export function invitationEmail(input: { companyName: string; roleLabel: string; link: string; expiresHours: number }): EmailMessage {
  const subject = `Undangan bergabung ke ${input.companyName} di Ardaya EPC`;
  const text = [
    `Anda diundang bergabung ke ${input.companyName} sebagai ${input.roleLabel}.`,
    "",
    `Buka tautan berikut untuk membuat akun (berlaku ${input.expiresHours} jam):`,
    input.link,
    "",
    "Bila Anda tidak mengenal pengirim email ini, abaikan saja.",
  ].join("\n");
  const html = shell(`Undangan bergabung`, `
    <p style="margin:0;font-size:13px;line-height:1.7">Anda diundang bergabung ke <strong>${esc(input.companyName)}</strong> sebagai <strong>${esc(input.roleLabel)}</strong>.</p>
    ${button(input.link, "Terima undangan")}
    <p style="margin:14px 0 0;font-size:12px;line-height:1.7;color:#6b7770">Tautan berlaku ${input.expiresHours} jam dan hanya dapat dipakai sekali.</p>`);
  return { to: "", subject, text, html };
}
