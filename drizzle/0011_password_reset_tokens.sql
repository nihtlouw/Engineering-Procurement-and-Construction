-- ============================================================================
-- 0011 · Token reset password via tautan email
-- ============================================================================
-- Sebelum ini, pemulihan password bergantung pada ADMIN yang mengetik password
-- baru di UI (atau CLI darurat). Itu berarti password selalu berpindah tangan
-- dalam bentuk terbaca. Dengan tabel ini, pengguna membuat password sendiri
-- lewat tautan sekali pakai.
--
-- Keamanan yang dijaga skema ini:
-- - hanya HASH token yang disimpan (SHA-256), token asli hanya ada di email;
-- - token sekali pakai (`used_at`) dan berbatas waktu (`expires_at`);
-- - permintaan baru mencabut token lama (`revoked_at`) sehingga hanya satu
--   tautan yang berlaku per akun;
-- - permintaan dapat dibatasi (`requested_ip`) dan diaudit.
--
-- Tabel control-plane: SENGAJA tidak di-RLS, konsisten dengan `invitations`
-- (lihat catatan di 0001). Akses dijaga oleh kode: query selalu lewat hash
-- token, dan route bersifat publik tetapi tidak pernah mengembalikan data akun.
-- ============================================================================

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    text NOT NULL UNIQUE,
  requested_ip  text,
  expires_at    timestamptz NOT NULL,
  used_at       timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Kueri utama: "token aktif terbaru untuk user ini" saat request baru dibuat.
CREATE INDEX IF NOT EXISTS password_reset_tokens_user_idx
  ON password_reset_tokens (user_id, created_at DESC);
-- Pembersihan berkala token kedaluwarsa.
CREATE INDEX IF NOT EXISTS password_reset_tokens_expires_idx
  ON password_reset_tokens (expires_at) WHERE used_at IS NULL AND revoked_at IS NULL;

COMMENT ON TABLE password_reset_tokens IS
  'Token reset password sekali pakai; hanya hash SHA-256 yang disimpan (0011).';
COMMENT ON COLUMN password_reset_tokens.used_at IS
  'Diisi saat password benar-benar diganti; token tidak dapat dipakai dua kali.';
COMMENT ON COLUMN password_reset_tokens.revoked_at IS
  'Diisi saat token digantikan permintaan baru atau dibatalkan admin.';
