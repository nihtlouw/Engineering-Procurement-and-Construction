import type { Role } from "@/lib/domain";

export type CompanyView = { id: string; name: string; slug: string };

export type MemberView = {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  title: string;
  companyRole: Role;
  status: string;
  joinedAt: string;
  invitedBy: string | null;
  /** 0010: akun sedang terkunci karena percobaan login gagal. */
  lockedUntil: string | null;
};

export type InviteResult = {
  email: string;
  companyRole: Role;
  token: string;
  expiresAt: string;
  /** Token mentah hanya dikembalikan SEKALI. Kirim via kanal aman di luar aplikasi. */
  delivery: "manual";
  acceptPath: string;
};

export type PendingInviteView = {
  id: string;
  email: string;
  companyRole: Role;
  expiresAt: string;
  revoked: boolean;
  accepted: boolean;
  createdAt: string;
};
