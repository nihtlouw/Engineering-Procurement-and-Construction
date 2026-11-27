-- ============================================================================
-- 0010 · Kunci akun setelah percobaan login gagal berulang
-- ============================================================================
-- Audit #7: rate limit login sebelumnya hanya per email dalam 60 detik, sehingga
-- penyerang yang berganti-ganti email/IP (atau menunggu satu menit) tetap bisa
-- menebak password tanpa batas total. Migrasi ini menambah penghitung kegagalan
-- yang persisten pada tabel `users` (bukan Map di memori instance).
--
-- Forward-only dan idempoten. Kolom baru nullable/default sehingga tidak ada
-- backfill data lama yang diperlukan: semua user mulai dengan 0 kegagalan.
-- ============================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_count integer NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until timestamptz;

-- Rentang wajar: penghitung tidak boleh negatif, dan tidak boleh tumbuh tanpa
-- batas karena satu baris dengan angka raksasa akan mengunci akun selamanya.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_failed_login_count_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_failed_login_count_check
      CHECK (failed_login_count >= 0 AND failed_login_count <= 1000);
  END IF;
END $$;

-- Index parsial: kueri yang relevan hanya akun yang SEDANG terkunci.
CREATE INDEX IF NOT EXISTS users_locked_until_idx
  ON users (locked_until) WHERE locked_until IS NOT NULL;

-- Pemulihan operasional: ADMIN dapat membuka kunci lewat /api/users/[id]/action
-- (aksi UNLOCK), dan kegagalan direset otomatis pada login yang berhasil.
COMMENT ON COLUMN users.failed_login_count IS
  'Jumlah percobaan login gagal berturut-turut; direset saat login berhasil (0010).';
COMMENT ON COLUMN users.locked_until IS
  'Akun ditolak login sampai waktu ini; NULL = tidak terkunci (0010).';
