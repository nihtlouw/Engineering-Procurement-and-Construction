/**
 * Isi Panduan Ardaya EPC.
 * Struktur blok: para, h2, h3, bullets, steps, table, callout, kv, rule.
 * Semua istilah mengikuti label yang benar-benar dipakai di aplikasi (src/lib/domain.ts).
 */

const table = (columns, rows, caption) => ({ type: "table", columns, rows, caption });
const callout = (title, text, tone) => ({ type: "callout", title, text, tone });
const bullets = (items) => ({ type: "bullets", items });
const steps = (items) => ({ type: "steps", items });
const para = (text) => ({ type: "para", text });
const h2 = (text) => ({ type: "h2", text });

export const CONTENT = {
  cover: {
    title: "Panduan Ardaya EPC dari awal hingga akhir",
    subtitle: "Cara memakai aplikasi untuk mengendalikan biaya, pengadaan, progres, penagihan, dan serah terima proyek kontraktor EPC elektro.",
    meta: "Versi 1.0 - 6 November 2026 - Dokumen internal PT Ardaya Energi Sistem",
    bullets: [
      { label: "Untuk siapa", body: "Admin, Project Manager, tim lapangan, procurement, dan finance. Setiap peran punya bab alurnya sendiri." },
      { label: "Cakupan", body: "Dari login pertama, menyiapkan proyek, mencatat nota lapangan, menyetujui, menagih, sampai menutup proyek." },
      { label: "Cara pakai", body: "Ikuti berurutan untuk pemula. Setiap bab diawali tujuan, diakhiri pemeriksaan hasil." },
      { label: "Data contoh", body: "Seluruh angka di panduan ini berasal dari data demo aplikasi, jadi bisa langsung dicocokkan saat latihan." },
    ],
  },

  chapters: [
    /* ---------------------------------------------------------------- 01 */
    {
      num: "01",
      title: "Mengenal aplikasi dan peran pengguna",
      kicker: "Bacalah lebih dulu",
      blocks: [
        para("Ardaya EPC adalah sistem kendali proyek untuk kontraktor pekerjaan elektro dan mekanikal. Satu alur menghubungkan anggaran, nota lapangan, komitmen pembelian, tagihan ke klien, dan serah terima. Semua angka aktual dapat ditelusuri kembali ke bukti nota dan keputusan persetujuannya."),
        h2("Apa yang bisa Anda lakukan di sini"),
        bullets([
          "Menyusun RAB klien dan anggaran internal yang terpisah, sehingga harga jual tidak pernah tercampur dengan biaya sendiri.",
          "Mencatat pengeluaran dari nota lapangan, termasuk pemindaian OCR dan pemeriksaan duplikat.",
          "Mengelola Purchase Order sebagai komitmen, bukan sebagai biaya aktual.",
          "Menerbitkan invoice berbasis termin, mencatat pembayaran, potongan PPh, dan retensi.",
          "Memantau progres fisik berbobot, change order, dokumen serah terima, dan audit trail.",
        ]),
        h2("Enam peran dan apa yang mereka lihat"),
        table(
          [
            { label: "Peran", width: 18 },
            { label: "Fokus pekerjaan", width: 40 },
            { label: "Contoh akun demo", width: 26 },
            { label: "Menu utama", width: 26 },
          ],
          [
            ["Admin", "Seluruh kontrol, pengguna, pengaturan, dan override gerbang tahap", "admin@ardaya.id", "Semua menu"],
            ["Project Manager", "Anggaran, approval biaya, jadwal, change order, dokumen", "pm@ardaya.id", "Ikhtisar, Proyek, Persetujuan, Pengeluaran, Tagihan, Dokumen, Peluang, Audit Trail"],
            ["Field", "Update progres lapangan dan pencatatan nota", "field@ardaya.id", "Proyek, Persetujuan, Pengeluaran (milik sendiri), Dokumen"],
            ["Procurement", "Purchase Order dan penerimaan barang", "procurement@ardaya.id", "Ikhtisar, Proyek, Persetujuan, Pengeluaran, Dokumen"],
            ["Finance", "Approval biaya, tagihan, pembayaran, reimburse, PPh", "finance@ardaya.id", "Ikhtisar, Persetujuan, Pengeluaran, Tagihan"],
            ["Estimator", "Peluang, proposal, RAB klien, survei", "estimator@ardaya.id", "Ikhtisar, Proyek, Peluang"],
          ],
          "Menu yang tampil mengikuti izin peran. Pengaturan hanya tampil untuk Admin. Bila sebuah menu tidak muncul, berarti peran Anda memang tidak memiliki izinnya, bukan karena aplikasi bermasalah."
        ),
        callout("Penting soal cakupan data", "Selain peran, akses juga dibatasi keanggotaan proyek. Project Manager hanya melihat proyek tempat ia terdaftar sebagai anggota. Jika angka portofolio terasa kurang, periksa keanggotaan proyek terlebih dahulu.", "warn"),
        h2("Peta alur kerja dari awal sampai akhir"),
        steps([
          { title: "Peluang dan proposal", body: "Peluang dicatat, proposal disusun, lalu dikonversi menjadi proyek satu kali." },
          { title: "Anggaran", body: "RAB klien disusun untuk harga jual. Anggaran internal disusun sebagai batas biaya, lalu dijadikan baseline." },
          { title: "Pengadaan", body: "Purchase Order diterbitkan sebagai komitmen. Nilainya belum dihitung sebagai biaya aktual." },
          { title: "Pelaksanaan dan biaya lapangan", body: "Nota lapangan dicatat, dipindai, disetujui, lalu menjadi biaya aktual pada pos anggaran." },
          { title: "Penagihan", body: "Invoice termin diterbitkan, dikirim, dibayar sebagian atau penuh, dengan potongan PPh dan retensi." },
          { title: "Serah terima dan penutupan", body: "BAST, daftar cacat, masa pemeliharaan, lalu proyek ditutup setelah pemeriksaan kelengkapan lolos." },
        ]),
      ],
    },

    /* ---------------------------------------------------------------- 02 */
    {
      num: "02",
      title: "Masuk, mengenal layar, dan menyiapkan akun",
      kicker: "Langkah pertama",
      blocks: [
        h2("Masuk ke aplikasi"),
        steps([
          { title: "Buka alamat aplikasi", body: "Di lingkungan pengembangan, alamatnya http://localhost:3000. Di produksi, gunakan alamat yang diberikan admin. Formulir masuk memiliki judul Selamat datang." },
          { title: "Isi email kantor dan kata sandi", body: "Gunakan email yang terdaftar. Bila mode demo aktif, tombol akun demo tersedia di bawah formulir untuk mengisi otomatis." },
          { title: "Tekan Masuk ke workspace", body: "Tidak ada layar awal terpisah. Anda langsung masuk ke Ikhtisar portofolio bila peran memiliki izin portofolio, atau ke daftar Proyek bila tidak, misalnya peran Field." },
        ]),
        callout("Bila gagal masuk", "Pesan Email atau password tidak sesuai muncul setiap kali kredensial salah. Setelah delapan percobaan gagal dalam satu menit, pesan berubah menjadi Terlalu banyak percobaan. Coba lagi dalam 1 menit. Tunggu satu menit, lalu coba lagi. Bila tetap gagal, minta admin menyetel ulang kata sandi.", "warn"),
        h2("Mengenal bagian layar"),
        bullets([
          "Sidebar kiri: navigasi utama, berisi Ikhtisar, Proyek, Persetujuan, Pengeluaran, Tagihan, Dokumen, Peluang, Audit Trail, dan Pengaturan.",
          "Topbar: jejak lokasi halaman, kotak Cari proyek, biaya, atau invoice, lonceng notifikasi, dan menu profil untuk keluar.",
          "Area kerja: isi halaman aktif. Di ponsel, sidebar berubah menjadi panel menu yang dibuka dari tombol di topbar.",
          "Lencana angka pada menu Persetujuan menunjukkan jumlah pengajuan berstatus Menunggu Persetujuan yang ditugaskan kepada Anda. Admin melihat seluruh antrean.",
        ]),
        h2("Mencari data dengan cepat"),
        para("Kotak pencarian di topbar mencakup proyek, pengeluaran, dan invoice dalam cakupan akses Anda. Mengetik kode seperti PRJ-2026-014 atau nomor invoice akan langsung menyaring hasil. Tekan Escape atau klik di luar hasil untuk menutup daftar."),
        h2("Membaca notifikasi"),
        para("Lonceng menampilkan notifikasi yang terkait dengan peran Anda, misalnya pengajuan biaya yang menunggu keputusan atau invoice yang mendekati jatuh tempo. Klik satu notifikasi untuk membuka halaman terkait. Titik merah berarti masih ada yang belum dibaca."),
        h2("Alamat halaman bisa dibagikan"),
        para("Setiap perpindahan halaman tercatat pada alamat, misalnya #/projects/u-pm-genset/budget untuk tab anggaran sebuah proyek. Artinya tautan bisa dikirim ke rekan kerja, ditandai, dan tombol kembali pada peramban berfungsi seperti biasa."),
      ],
    },

    /* ---------------------------------------------------------------- 03 */
    {
      num: "03",
      title: "Menyiapkan proyek baru dari peluang",
      kicker: "Untuk Admin, Estimator, dan PM",
      blocks: [
        para("Proyek tidak dibuat dari nol. Alurnya dimulai dari peluang, disusun proposalnya, lalu dikonversi menjadi proyek. Aturan ini menjaga agar setiap proyek punya jejak asal yang jelas dan tidak ada peluang yang dikonversi dua kali."),
        h2("Mencatat peluang"),
        steps([
          { title: "Buka menu Peluang", body: "Daftar peluang aktif tampil sebagai kartu berisi kode, status, nilai estimasi, dan tenggat." },
          { title: "Buat peluang baru", body: "Isi nama peluang, klien, pemilik, kebutuhan teknis, nilai estimasi, dan tenggat penawaran." },
          { title: "Perbarui status", body: "Status berjalan dari kualifikasi, penawaran, negosiasi, sampai menang atau kalah. Status menentukan apakah proposal dapat disusun." },
        ]),
        h2("Menyusun RAB klien"),
        para("RAB klien adalah harga jual kepada klien. Isinya pos pekerjaan, volume, satuan, dan harga satuan. RAB ini terpisah sepenuhnya dari anggaran internal, sehingga dokumen yang dikirim ke klien tidak pernah membuka struktur biaya Anda."),
        table(
          [{ label: "Kolom", width: 22 }, { label: "Arti", width: 46 }, { label: "Contoh", width: 32 }],
          [
            ["Kode pos", "Penanda pos pekerjaan, dipakai juga di anggaran internal", "EQP-01, LAB-01, CIV-01"],
            ["Uraian", "Nama pekerjaan yang dapat dipahami klien", "Genset 500 kVA silent canopy"],
            ["Volume dan satuan", "Kuantitas beserta satuan dasar", "2 unit, 1 lot, 120 m"],
            ["Harga satuan", "Harga jual per satuan", "1.125.000.000"],
            ["Total", "Volume dikali harga satuan", "2.250.000.000"],
          ]
        ),
        h2("Mengubah peluang menjadi proyek"),
        steps([
          { title: "Pastikan proposal sudah disetujui", body: "Konversi hanya bisa dilakukan pada peluang yang menang dan proposalnya berstatus disetujui. Peluang yang masih dalam negosiasi belum dapat dikonversi." },
          { title: "Jalankan konversi satu kali", body: "Sistem membuat proyek, menyalin RAB klien sebagai versi pertama, dan menautkan proyek ke peluang asal. Tombol konversi tidak muncul lagi setelah berhasil." },
          { title: "Lengkapi data proyek", body: "Isi nomor kontrak, tanggal kontrak, nilai kontrak, lokasi, Project Manager, tanggal mulai, target selesai, retensi, dan masa pemeliharaan." },
        ]),
        callout("Nilai kontrak adalah dasar perhitungan", "Nilai kontrak berjalan menjadi dasar margin, persentase retensi, dan rekap portofolio. Perubahan setelah baseline harus lewat change order, bukan dengan menyunting nilai kontrak langsung.", "ok"),
      ],
    },

    /* ---------------------------------------------------------------- 04 */
    {
      num: "04",
      title: "Menyusun anggaran internal dan baseline",
      kicker: "Inti kendali biaya",
      blocks: [
        para("Anggaran internal adalah batas biaya Anda sendiri. Inilah angka yang dibandingkan dengan biaya aktual setiap hari. Tanpa baseline, aplikasi tidak bisa memberi peringatan ketika sebuah pos sudah terlampaui."),
        h2("Membuat versi anggaran"),
        steps([
          { title: "Buka proyek, lalu tab Lingkup dan Anggaran", body: "Pilih tombol Anggaran internal. Bila belum ada, buat versi baru dengan nomor versi otomatis." },
          { title: "Isi pos pekerjaan", body: "Setiap baris berisi kode, uraian, kategori biaya, volume, satuan, dan nilai anggaran. Kategori menentukan apakah biaya masuk ke proyek atau overhead." },
          { title: "Aktifkan sebagai baseline", body: "Hanya RAB klien atau anggaran internal yang berstatus Disetujui yang dapat dijadikan baseline. Setiap jenis hanya punya satu versi aktif, dan versi itu dipakai untuk semua perbandingan biaya aktual." },
        ]),
        h2("Cara membaca tabel anggaran"),
        table(
          [{ label: "Kolom", width: 20 }, { label: "Arti", width: 44 }, { label: "Perhatian", width: 36 }],
          [
            ["Anggaran", "Nilai pos pada baseline aktif", "Dasar semua perhitungan sisa"],
            ["Aktual", "Biaya dari pengeluaran berstatus Disetujui", "Belum termasuk yang masih menunggu"],
            ["Pending", "Biaya yang sudah diajukan tetapi belum disetujui", "Bisa berubah menjadi aktual"],
            ["Sisa", "Anggaran dikurangi aktual", "Angka negatif berarti pos terlampaui"],
            ["Terpakai", "Persentase aktual terhadap anggaran", "Kuning di atas 90 persen, merah di atas 100 persen"],
          ]
        ),
        callout("Ambang peringatan", "Bilah berubah kuning ketika pos terpakai melewati 90 persen dan merah ketika melewati 100 persen. Sisa yang negatif ditampilkan tebal berwarna merah agar tidak terlewat saat memindai tabel.", "note"),
        h2("Mengubah anggaran tanpa merusak riwayat"),
        bullets([
          "Perubahan kecil di dalam baseline yang sama dicatat pada Audit Trail beserta nilai lama dan nilai baru.",
          "Perubahan lingkup yang berdampak nilai harus lewat change order, sehingga margin sebelum dan sesudahnya dapat dibandingkan.",
          "Versi lama tidak dihapus. Statusnya berubah dari Baseline Aktif menjadi Digantikan, dan tetap dapat dibuka untuk pemeriksaan.",
        ]),
      ],
    },

    /* ---------------------------------------------------------------- 05 */
    {
      num: "05",
      title: "Purchase Order sebagai komitmen",
      kicker: "Pengadaan",
      blocks: [
        para("Purchase Order adalah janji membayar kepada pemasok. Nilainya belum menjadi biaya aktual. Biaya baru muncul ketika tagihan PO dicatat sebagai pengeluaran dan disetujui. Pemisahan ini mencegah laporan biaya membengkak karena barang yang belum diterima."),
        h2("Menerbitkan PO"),
        steps([
          { title: "Buka tab Pengadaan dan Biaya", body: "Tekan Buat PO. Formulir meminta proyek, pemasok, ringkasan pengadaan, nilai DPP, PPN, tanggal order, perkiraan tiba, dan pos anggaran." },
          { title: "Pilih status awal", body: "PO dibuat sebagai Draft. Status naik satu langkah setiap kali tombol status ditekan: Draft, Diminta, Dipesan, Diterima Sebagian, Diterima, lalu Ditutup. Nomor PO wajib diisi agar PO dapat dikenali pemasok dan finance." },
          { title: "Simpan dan pantau", body: "Kartu PO menampilkan nilai DPP, jumlah yang sudah tertagih lewat PO, dan sisa komitmen yang belum ditagihkan." },
        ]),
        h2("Perpindahan status PO"),
        table(
          [{ label: "Dari", width: 22 }, { label: "Ke", width: 26 }, { label: "Kapan" }, { label: "Efek pada sisa komitmen", width: 30 }],
          [
            ["Draft", "Diminta", "PO diajukan untuk persetujuan internal", "Belum dihitung"],
            ["Diminta", "Dipesan", "PO disetujui dan dikirim ke pemasok", "Mulai dihitung sebagai komitmen"],
            ["Dipesan", "Diterima Sebagian", "Barang atau jasa datang sebagian", "Berkurang sesuai tagihan PO yang disetujui"],
            ["Diterima Sebagian", "Diterima", "Seluruh barang atau jasa selesai", "Berkurang sampai nol bila semua sudah ditagih"],
            ["Diterima", "Ditutup", "Tidak ada lagi tagihan yang diperkirakan datang", "Komitmen selesai"],
          ]
        ),
        callout("Komitmen hanya berkurang lewat tagihan yang disetujui", "Menandai PO sebagai Diterima tidak mengubah laporan biaya. Yang mengubah adalah pengeluaran bertipe Tagihan PO yang sudah disetujui dan tertaut ke PO tersebut.", "warn"),
      ],
    },

    /* ---------------------------------------------------------------- 06 */
    {
      num: "06",
      title: "Mencatat biaya lapangan dari nota",
      kicker: "Alur paling sering dipakai",
      blocks: [
        para("Pencatatan biaya dibagi menjadi empat langkah agar tidak ada data yang terlewat. Wizard dapat diselesaikan sekaligus atau disimpan sebagai draft lebih dulu."),
        h2("Empat langkah pencatatan"),
        steps([
          { title: "Foto dan OCR", body: "Unggah foto nota atau PDF lewat kotak Ambil / unggah foto nota. Gambar dikompresi otomatis. Tombol Proses OCR membaca teks di server, hasilnya hanya usulan yang harus Anda periksa, tidak langsung mengisi biaya." },
          { title: "Detail nota", body: "Tentukan tujuan biaya (Proyek atau Overhead kantor), proyek, merchant, nomor nota, tanggal transaksi, metode bayar, dan sumber dana." },
          { title: "Baris biaya", body: "Satu nota bisa berisi beberapa baris. Setiap baris punya kategori biaya dan pos anggaran sendiri, misalnya sewa alat masuk EQP dan transport masuk LOG. Tombol Tambah baris menambah baris baru, ikon tempat sampah menghapusnya." },
          { title: "Tinjau dan kirim", body: "Periksa ringkasan, total, PPN, dan PPh. Bila total nota berbeda dari jumlah baris ditambah PPN, alasannya wajib ditulis. Setelah itu tekan Simpan draft atau Simpan & kirim." },
        ]),
        h2("Status pengeluaran dan artinya"),
        table(
          [{ label: "Status", width: 24 }, { label: "Arti", width: 44 }, { label: "Siapa yang bertindak", width: 32 }],
          [
            ["Draft", "Masih disusun pemilik nota, belum masuk antrean", "Pembuat nota"],
            ["Menunggu Persetujuan", "Sudah dikirim dan menunggu keputusan approver", "Approver yang ditunjuk"],
            ["Perlu Perbaikan", "Dikembalikan karena data kurang atau bukti tidak jelas", "Pembuat nota memperbaiki lalu kirim ulang"],
            ["Disetujui", "Sah menjadi biaya aktual pada pos anggaran", "Selesai, menunggu proses bayar atau reimburse"],
            ["Ditolak", "Tidak diakui sebagai biaya", "Selesai, tidak dapat dikirim ulang"],
            ["Dibatalkan (Void)", "Pernah disetujui tetapi dibatalkan karena kekeliruan", "Finance atau Admin"],
          ]
        ),
        callout("Lima kesalahan yang paling sering terjadi", "Nomor nota kosong sehingga sulit dicocokkan dengan bukti. Tanggal transaksi tertukar dengan tanggal input. Kategori biaya dibiarkan kosong sehingga pengajuan ditolak saat dikirim. Total nota tidak sama dengan jumlah baris ditambah PPN tanpa alasan tertulis. Nota difoto miring sehingga OCR gagal membaca.", "danger"),
        h2("Menyimpan draft saat jaringan buruk"),
        para("Di lapangan, simpan draft lebih dulu. Bila perangkat sedang luring, aplikasi menaruh catatan pada antrean lokal dan mengirimkannya saat kembali daring. Panel antrean menampilkan jumlah yang belum terkirim dan tombol percobaan ulang."),
        h2("Biaya overhead"),
        para("Overhead kantor tidak pernah masuk biaya proyek. Ketika tujuan biaya dipilih Overhead, baris tidak bisa ditautkan ke pos anggaran proyek. Ini menjaga margin proyek tetap bersih dari biaya kantor."),
        h2("Pemeriksaan duplikat dan pemisahan nota"),
        para("Nota yang sama tidak boleh dicatat dua kali. Sebelum menyimpan, aplikasi membandingkan kombinasi merchant, tanggal transaksi, dan nominal terhadap catatan yang sudah ada pada proyek yang sama. Bila ada kemiripan, muncul peringatan berisi kode pengeluaran yang mirip agar Anda dapat membuka dan membandingkannya."),
        bullets([
          "Peringatan duplikat bukan penolakan. Anda tetap dapat melanjutkan bila memang dua transaksi berbeda, misalnya dua kali sewa alat sehari penuh.",
          "Nota besar yang menagih beberapa pos boleh dipecah menjadi beberapa pengeluaran, sesuai izin split nota pada menu Pengaturan.",
          "Jangan memecah nota hanya agar tiap pengeluaran terlihat kecil. Pemecahan harus mengikuti pos biaya yang sebenarnya.",
        ]),
      ],
    },

    /* ---------------------------------------------------------------- 07 */
    {
      num: "07",
      title: "Menyetujui atau mengembalikan pengajuan",
      kicker: "Untuk PM dan Finance",
      blocks: [
        para("Kotak persetujuan menampilkan satu pengajuan pada satu waktu, dengan bukti nota di kiri dan ringkasan angka di kanan. Tujuannya agar keputusan diambil setelah melihat bukti, bukan hanya nominalnya."),
        h2("Langkah menyetujui"),
        steps([
          { title: "Buka menu Persetujuan", body: "Antrean berisi pengajuan yang ditugaskan kepada Anda, atau seluruh pengajuan bila Anda Admin. Approver ditentukan otomatis saat pengajuan dikirim: PM proyek, atau Finance bila notanya lintas proyek, berisi overhead, atau dibuat oleh PM proyek itu sendiri." },
          { title: "Periksa bukti nota", body: "Gunakan tombol perbesar, perkecil, dan putar. Pastikan merchant, tanggal, dan nominal pada nota sesuai dengan isian." },
          { title: "Cocokkan dengan pos anggaran", body: "Perhatikan peringatan bila pos sudah mencapai 100 persen. Menyetujui berarti Anda sadar melewati pagu pos tersebut." },
          { title: "Ambil keputusan", body: "Setujui, Kembalikan untuk perbaikan, atau Tolak. Untuk kembalikan dan tolak, tulis alasan singkat yang bisa dibaca pengaju." },
        ]),
        table(
          [{ label: "Keputusan", width: 20 }, { label: "Akibat", width: 44 }, { label: "Yang harus ditulis", width: 36 }],
          [
            ["Setujui", "Nilai masuk biaya aktual pada pos anggaran terkait", "Catatan opsional"],
            ["Kembalikan", "Status menjadi Perlu Perbaikan, pengaju dapat memperbaiki dan mengirim ulang", "Alasan wajib"],
            ["Tolak", "Pengajuan selesai dan tidak dapat dikirim ulang", "Alasan wajib"],
          ]
        ),
        callout("Pemisahan tugas", "Orang yang mencatat nota tidak dapat menyetujui notanya sendiri. Admin adalah satu-satunya peran yang dapat memproses notanya sendiri, dan itu pun wajib menuliskan alasan override. Untuk peran lain, sistem menolak dengan pesan Pembuat record tidak boleh memproses persetujuannya sendiri. Ini aturan pengendalian internal, bukan gangguan.", "ok"),
        h2("Pintasan papan tombol"),
        bullets([
          "A untuk menyetujui pengajuan yang sedang dibuka.",
          "R untuk meminta perbaikan, pengajuan kembali ke pengaju.",
          "X untuk menolak.",
          "Pintasan tidak aktif ketika kursor berada di kolom isian, agar tidak ada keputusan yang terkirim tanpa sengaja.",
        ]),
      ],
    },

    /* ---------------------------------------------------------------- 08 */
    {
      num: "08",
      title: "Tagihan, pembayaran, PPh, dan retensi",
      kicker: "Untuk Finance dan PM",
      blocks: [
        para("Modul tagihan menghubungkan nilai termin pada kontrak dengan invoice yang benar-benar dikirim ke klien, lalu dengan uang yang masuk. Saldo dihitung sebagai total invoice dikurangi kas diterima dan potongan PPh."),
        h2("Menerbitkan invoice termin"),
        steps([
          { title: "Buka tab Tagihan pada proyek", body: "Tabel termin menampilkan uang muka, progres, final, dan retensi beserta target tanggalnya." },
          { title: "Buat invoice dari termin", body: "Tekan Buat invoice. Nilai termin adalah DPP, PPN dihitung pada invoice. Isi tanggal terbit dan jatuh tempo, lalu simpan sebagai draft." },
          { title: "Setujui lalu kirim", body: "Invoice berstatus Draft harus disetujui internal menjadi Disetujui Internal sebelum dikirim. Setelah dikirim, status berubah menjadi Terkirim dan saldo mulai dihitung terhadap jatuh tempo." },
        ]),
        h2("Mencatat pembayaran"),
        steps([
          { title: "Buka invoice yang dibayar", body: "Rincian invoice menampilkan riwayat pembayaran sebelumnya, bila ada." },
          { title: "Isi penerimaan dan potongan", body: "Masukkan kas diterima dan potongan PPh. Bila ada potongan PPh, jenisnya wajib dipilih. Isi juga tanggal dan referensi pembayaran. Total kas ditambah potongan harus lebih besar dari nol dan tidak boleh melebihi saldo invoice." },
          { title: "Periksa status akhir", body: "Bila kas ditambah potongan mencapai total invoice, status menjadi Lunas. Bila belum, status menjadi Sebagian Dibayar dan saldo tetap tercatat." },
        ]),
        callout("Arti status terlambat", "Status Terlambat muncul otomatis ketika tanggal hari ini melewati jatuh tempo dan saldo masih lebih besar dari nol. Status ini tidak perlu disetel manual dan akan hilang sendiri setelah pembayaran tercatat.", "note"),
        h2("Reimburse karyawan"),
        para("Pengeluaran yang dibayar lebih dulu oleh karyawan memiliki status reimburse tersendiri, yaitu Menunggu Reimburse, Reimburse Sebagian, dan Sudah Direimburse. Status ini terpisah dari status persetujuan biaya, sehingga biaya bisa sudah disetujui tetapi uangnya belum kembali ke karyawan."),
        h2("Retensi"),
        para("Retensi dihitung dari persentase pada data proyek dan dipotong pada invoice final. Nilainya tetap tercatat sebagai retensi outstanding sampai dibayar setelah masa pemeliharaan berakhir."),
      ],
    },

    /* ---------------------------------------------------------------- 09 */
    {
      num: "09",
      title: "Progres lapangan dan jadwal",
      kicker: "Untuk tim lapangan dan PM",
      blocks: [
        para("Progres proyek dihitung dari bobot setiap item jadwal, bukan dari rata-rata sederhana. Item berbobot besar memberi pengaruh besar. Karena itu, menjaga bobot tetap masuk akal adalah bagian dari pekerjaan perencanaan."),
        h2("Memperbarui progres"),
        steps([
          { title: "Buka tab Jadwal dan Progres", body: "Daftar item menampilkan bobot, rencana mulai dan selesai, status, serta penanda berisiko untuk item yang melewati rencana." },
          { title: "Perbarui item", body: "Isi persentase progres beserta catatan lapangan, lalu simpan. Progres terbobot proyek dihitung ulang dari bobot setiap item, bukan dari rata-rata sederhana." },
          { title: "Simpan dan periksa ringkasan", body: "Progres terbobot proyek dihitung ulang dan tampil pada pita tahap di tab Ringkasan." },
        ]),
        h2("Item berisiko"),
        bullets([
          "Item dianggap berisiko ketika tanggal rencana selesai sudah lewat dan statusnya belum Selesai.",
          "Penanda berisiko muncul juga pada antrean Perlu tindakan di halaman Ikhtisar, sehingga PM melihatnya tanpa membuka proyek.",
          "Setelah item benar-benar selesai, ubah statusnya. Penanda akan hilang dan progres terbobot ikut naik.",
        ]),
        callout("Catatan lapangan lebih berguna daripada angka saja", "Tulis isu secara spesifik, misalnya menunggu kiriman panel ATS dari pemasok sejak 3 November. Catatan ini yang dipakai saat rapat mingguan dan saat menyusun klaim keterlambatan.", "ok"),
      ],
    },

    /* ---------------------------------------------------------------- 10 */
    {
      num: "10",
      title: "Change order dan dampaknya pada margin",
      kicker: "Ketika lingkup berubah",
      blocks: [
        para("Pekerjaan tambahan yang dikerjakan tanpa change order akan merusak margin tanpa jejak. Change order memisahkan dengan jelas apa yang berubah, berapa nilainya, dan siapa yang menyetujui."),
        h2("Membuat change order"),
        steps([
          { title: "Buka tab Change Order", body: "Tekan Buat change order, lalu isi judul, alasan, uraian lingkup, dampak harga ke klien, dampak biaya internal, dan dampak waktu dalam hari." },
          { title: "Ajukan persetujuan", body: "Change order disimpan sebagai Draft, lalu diajukan dan berstatus Dalam Review sampai ada keputusan." },
          { title: "Terapkan", body: "Setelah berstatus Disetujui, terapkan change order. Sistem membuat versi baru RAB klien dan anggaran internal: RAB klien ditambah dampak harga, anggaran internal ditambah dampak biaya. Nilai kontrak berjalan dan margin ikut dihitung ulang." },
        ]),
        table(
          [{ label: "Komponen", width: 26 }, { label: "Arti", width: 40 }, { label: "Contoh" }],
          [
            ["Dampak harga", "Perubahan nilai kontrak ke klien", "Tambah 180.000.000 untuk panel sinkronisasi"],
            ["Dampak biaya", "Perubahan biaya internal yang diperlukan", "Tambah 120.000.000 untuk material dan upah"],
            ["Dampak waktu", "Tambahan hari pada target selesai", "Tambah 14 hari kerja"],
            ["Selisih", "Dampak harga dikurangi dampak biaya", "Margin tambahan 60.000.000"],
          ]
        ),
        callout("Urutan yang benar", "Ajukan dan setujui change order sebelum pekerjaan tambahan dieksekusi. Bila pekerjaan terlanjur berjalan, catat tetap sebagai change order dan jelaskan tanggal sebenarnya di uraian, agar jejak audit tetap jujur.", "warn"),
      ],
    },

    /* ---------------------------------------------------------------- 11 */
    {
      num: "11",
      title: "Dokumen, serah terima, dan penutupan",
      kicker: "Akhir siklus proyek",
      blocks: [
        para("Dokumen final memiliki nomor, snapshot data pada saat diterbitkan, dan PDF terkunci. Revisi tidak menimpa versi sebelumnya, sehingga dokumen yang sudah ditandatangani tetap dapat ditelusuri."),
        h2("Menerbitkan dokumen"),
        steps([
          { title: "Pilih template", body: "Tersedia antara lain BAST 1, BAST 2, laporan progres, invoice, dan berita acara pekerjaan tambahan. Setiap template punya blok isi dan pihak penanda tangan." },
          { title: "Isi data yang diperlukan", body: "Sebagian data terisi otomatis dari proyek. Periksa nomor dokumen, tanggal, dan pihak yang menandatangani." },
          { title: "Terbitkan", body: "Setelah diterbitkan, dokumen berstatus final, nomor terkunci, dan PDF tersedia untuk diunduh." },
        ]),
        h2("Serah terima"),
        steps([
          { title: "BAST 1", body: "Serah terima pertama dari pekerjaan. Mencatat tanggal dan lingkup yang diserahterimakan. Tahap proyek baru dapat naik ke Masa Pemeliharaan setelah tanggal BAST 1 tercatat dan dokumen BAST 1 berstatus final." },
          { title: "Punch list", body: "Setiap temuan dicatat, misalnya label kabel kontrol di panel sinkronisasi belum lengkap. Item ditutup setelah perbaikannya selesai, dan seluruh item wajib tertutup sebelum proyek dapat ditutup." },
          { title: "BAST 2", body: "Serah terima akhir setelah temuan diperbaiki. Tahap Penutupan menunggu dua syarat: BAST 2 tercatat, atau masa pemeliharaan yang dihitung dari BAST 1 sudah berakhir." },
          { title: "Masa pemeliharaan", body: "Selama masa ini retensi masih ditahan. Setelah berakhir dan saldo retensi nol, proyek siap ditutup." },
        ]),
        h2("Penutupan proyek"),
        para("Sebelum menutup, sistem menjalankan pemeriksaan kelengkapan. Proyek hanya bisa ditutup bila seluruh syarat terpenuhi. Contoh pesan yang muncul beserta artinya:"),
        table(
          [{ label: "Pesan pemeriksaan", width: 46 }, { label: "Artinya", width: 34 }, { label: "Tindakan" }],
          [
            ["3 pengeluaran belum final", "Masih ada pengeluaran berstatus Draft, Menunggu Persetujuan, atau Perlu Perbaikan pada proyek ini", "Selesaikan persetujuannya atau batalkan pengeluarannya"],
            ["2 item masih terbuka", "Masih ada item punch list yang belum ditutup", "Tutup item setelah perbaikannya benar-benar selesai"],
            ["1 dokumen belum lengkap", "Checklist serah terima wajib belum ditandai selesai, misalnya As-Built SLD atau BA Commissioning", "Lengkapi lalu tandai selesai"],
            ["Saldo retensi Rp 251.750.000", "Retensi belum lunas dibayar klien", "Catat pembayaran retensi sebelum menutup"],
          ]
        ),
        callout("Override hanya untuk Admin", "Admin dapat melewati pemeriksaan penutupan dengan menuliskan alasan. Alasan itu tersimpan permanen pada Audit Trail dan akan terlihat pada pemeriksaan berikutnya. Gunakan hanya bila keadaan memang memaksa.", "warn"),
        h2("Setelah proyek ditutup"),
        para("Proyek berstatus Proyek Selesai tidak lagi menerima catatan biaya baru, invoice baru, atau perubahan jadwal. Data tetap dapat dibaca, diekspor, dan dipakai sebagai pembanding pada proyek berikutnya."),
        bullets([
          "Seluruh dokumen final tetap dapat diunduh beserta snapshot datanya.",
          "Angka aktual akhir, margin, dan retensi terkunci sebagai catatan penutup pada portofolio.",
          "Bila setelah penutupan muncul tagihan pemasok yang sah, biaya dicatat sebagai koreksi penutupan dan hanya dapat dilakukan Admin atau Finance, dengan alasan tertulis.",
        ]),
      ],
    },

    /* ---------------------------------------------------------------- 12 */
    {
      num: "12",
      title: "Ikhtisar, Audit Trail, dan pengaturan",
      kicker: "Kontrol harian",
      blocks: [
        h2("Membaca halaman Ikhtisar"),
        bullets([
          "Biaya aktual: nilai yang sudah disetujui, dibandingkan nilai kontrak berjalan.",
          "Piutang: total yang belum dibayar klien, dengan penanda merah untuk yang lewat jatuh tempo.",
          "Sisa komitmen PO: nilai Purchase Order yang belum ditagihkan pemasok.",
          "Margin indikatif: kontrak berjalan dikurangi biaya aktual, beserta persentasenya.",
          "Perlu tindakan: gabungan invoice terlambat, pengajuan menunggu keputusan, dan item jadwal berisiko.",
          "Portofolio: dua bilah per proyek, yaitu progres fisik dan persentase anggaran terpakai.",
        ]),
        h2("Audit Trail"),
        para("Setiap perubahan status, nilai, persetujuan, pembayaran, dan dokumen tercatat dengan pelaku, waktu, nilai lama, nilai baru, serta alasan. Jejak ini tidak dapat diubah atau dihapus, termasuk oleh Admin. Gunakan menu Audit Trail untuk menjawab pertanyaan seperti siapa yang mengubah nilai kontrak dan kapan."),
        h2("Pengaturan perusahaan"),
        table(
          [{ label: "Bagian", width: 30 }, { label: "Isi", width: 40 }, { label: "Perlu kehati-hatian" }],
          [
            ["Identitas perusahaan", "Nama legal, nama tampilan, NPWP, alamat, kontak", "Dipakai pada dokumen dan laporan"],
            ["Parameter biaya", "Tarif PPN default dan izin split nota", "Mengubah tarif memengaruhi perhitungan invoice berikutnya"],
            ["Pengguna dan peran", "Daftar pengguna beserta peran aktifnya", "Peran menentukan luas data yang terlihat"],
            ["Kamus biaya dan satuan", "Kategori biaya beserta penanda overhead, serta satuan dasar", "Salah menandai overhead membuat biaya proyek keliru"],
          ]
        ),
        callout("Dokumen final memakai snapshot", "Dokumen yang sudah diterbitkan menyimpan data pada saat terbit. Mengubah pengaturan perusahaan hari ini tidak mengubah dokumen lama, dan itu memang yang diinginkan untuk keperluan audit.", "ok"),
      ],
    },

    /* ---------------------------------------------------------------- 13 */
    {
      num: "13",
      title: "Latihan terbimbing dengan data contoh",
      kicker: "Praktikkan sendiri",
      blocks: [
        para("Latihan ini memakai data demo. Lakukan berurutan pada satu proyek, dan setiap langkah diakhiri pemeriksaan hasil. Total waktu sekitar 30 menit."),
        steps([
          { title: "Masuk sebagai PM", body: "Email pm@ardaya.id dengan kata sandi demo. Atau tekan kartu akun demo PM pada halaman masuk. Anda langsung mendarat di Ikhtisar portofolio." },
          { title: "Buka proyek genset", body: "Pilih PRJ-2026-014. Periksa nilai kontrak, progres fisik di pita tahap, dan tab Lingkup dan Anggaran." },
          { title: "Periksa satu pos anggaran", body: "Cari pos Panel ATS. Perhatikan nilai anggaran, aktual, dan sisa pos. Pos yang terpakai di atas 90 persen berwarna kuning, di atas 100 persen berwarna merah." },
          { title: "Catat biaya baru", body: "Tekan Catat biaya, unggah foto nota apa pun, lalu tekan Proses OCR. Isi merchant dan tanggal, lalu buat dua baris dengan kategori biaya berbeda dan pos anggaran berbeda. Simpan draft." },
          { title: "Kirim untuk persetujuan", body: "Buka pengeluaran yang baru dibuat lalu kirim. Approver otomatis jatuh ke PM proyek. Catat kode pengeluarannya, misalnya EXP-2026-0000xx." },
          { title: "Setujui dari akun lain", body: "Keluar lalu masuk sebagai admin@ardaya.id, atau sebagai finance@ardaya.id bila notanya lintas proyek. Buka menu Persetujuan, cari kode tadi, periksa bukti, lalu setujui. Perhatikan nilai aktual pada pos anggaran terkait berubah." },
          { title: "Periksa dampaknya", body: "Masuk kembali sebagai PM. Buka proyek, tab Lingkup dan Anggaran. Nilai aktual dan sisa pos berubah, dan baris tersebut muncul pada tabel pengeluaran terbaru di Ikhtisar." },
          { title: "Terbitkan dokumen", body: "Buka tab Dokumen, tekan Generate dokumen, pilih template laporan progres, buat draft beserta snapshot, lalu finalkan. Unduh PDF-nya dan periksa bahwa nomor dokumen terkunci." },
          { title: "Periksa Audit Trail", body: "Buka menu Audit Trail. Temukan catatan persetujuan pengeluaran tadi beserta pelaku, waktu, dan perubahan nilainya." },
        ]),
        callout("Bila ada langkah yang gagal", "Baca pesan galatnya baik-baik. Hampir semua penolakan berasal dari aturan yang sah, misalnya pos anggaran sudah penuh, nomor nota duplikat, atau Anda mencoba menyetujui nota sendiri. Pesan galat selalu menyebut alasannya.", "note"),
      ],
    },

    /* ---------------------------------------------------------------- 14 */
    {
      num: "14",
      title: "Pertanyaan yang sering muncul dan penyelesaian masalah",
      kicker: "Rujukan cepat",
      blocks: [
        h2("Pertanyaan umum"),
        table(
          [{ label: "Pertanyaan", width: 36 }, { label: "Jawaban", width: 64 }],
          [
            ["Mengapa menu tertentu tidak muncul?", "Menu mengikuti izin peran. Bila peran Anda tidak memiliki izinnya, menu tidak ditampilkan. Hubungi admin bila akses memang dibutuhkan."],
            ["Mengapa proyek rekan kerja tidak terlihat?", "Akses dibatasi keanggotaan proyek. Mintalah admin menambahkan Anda sebagai anggota proyek tersebut."],
            ["Mengapa nilai aktual tidak berubah setelah saya mencatat nota?", "Biaya aktual baru dihitung setelah pengeluaran disetujui. Selama masih menunggu, nilainya masuk kolom pending."],
            ["Mengapa saya tidak bisa menyetujui pengajuan saya sendiri?", "Aturan pemisahan tugas melarangnya. Hanya Admin yang dapat memproses notanya sendiri, dan itu wajib disertai alasan override."],
            ["Bisakah pengeluaran yang sudah disetujui diubah?", "Tidak. Yang dapat dilakukan adalah membatalkannya (void) dengan alasan, lalu membuat catatan baru yang benar."],
            ["Mengapa invoice berstatus terlambat padahal klien bilang sudah bayar?", "Pembayaran baru tercatat setelah finance mengisi penerimaan. Minta finance mencatat pembayaran beserta referensinya."],
            ["Mengapa proyek tidak bisa ditutup?", "Masih ada syarat yang belum terpenuhi: saldo retensi, pengeluaran belum final, punch list terbuka, atau checklist dokumen wajib. Setiap baris pemeriksaan menyebut jumlah dan jenis kekurangannya."],
            ["Apakah data aman bila internet putus saat mengisi nota?", "Simpan draft. Bila pengiriman gagal karena jaringan, catatan masuk antrean lokal, tampil pada panel antrean, dan dapat dikirim ulang saat kembali daring."],
          ]
        ),
        h2("Penyelesaian masalah"),
        table(
          [{ label: "Gejala", width: 32 }, { label: "Penyebab yang paling sering", width: 68 }],
          [
            ["Halaman menampilkan Data gagal dimuat", "Koneksi ke server terputus atau sesi berakhir. Halaman galat menampilkan kode kejadian (digest). Tekan tombol coba lagi, bila tetap gagal muat ulang lalu masuk kembali."],
            ["OCR tidak membaca apa pun", "Foto miring, gelap, atau terpotong. Foto ulang dengan pencahayaan cukup dan seluruh tepi nota terlihat."],
            ["Muncul peringatan nota serupa", "Kombinasi merchant, tanggal, dan nominal mirip dengan catatan lain. Buka kode pengeluaran yang disebut pada peringatan sebelum melanjutkan, agar tidak ada biaya ganda."],
            ["Bilah anggaran berubah merah", "Pos sudah melewati 100 persen. Periksa apakah ada biaya yang salah pos, atau ajukan change order bila memang perlu tambahan."],
            ["Tombol simpan tidak bereaksi", "Ada isian wajib yang kosong atau tidak valid. Gulir ke atas, kolom bermasalah diberi garis merah beserta penjelasannya."],
            ["Angka berbeda antara Ikhtisar dan proyek", "Ikhtisar menjumlahkan semua proyek dalam cakupan Anda. Pastikan filter dan keanggotaan proyek sudah sesuai."],
          ]
        ),
        callout("Sebelum menghubungi admin", "Catat tiga hal: apa yang Anda lakukan, pesan galat lengkap yang muncul, dan kode kejadian bila ditampilkan pada halaman galat. Ketiganya mempercepat penyelesaian masalah.", "ok"),
        h2("Laporan masalah yang baik"),
        steps([
          { title: "Tulis apa yang Anda coba lakukan", body: "Sebutkan halaman dan tombolnya, misalnya menekan Simpan & kirim pada pengeluaran EXP-2026-000046." },
          { title: "Sertakan pesan galat apa adanya", body: "Salin teks lengkapnya, jangan diringkas. Pesan itulah yang menunjukkan aturan mana yang menolak." },
          { title: "Sebutkan waktu dan perangkat", body: "Waktu kejadian, peramban yang dipakai, serta apakah Anda sedang di kantor atau di lapangan. Perbedaan ini sering menjelaskan penyebabnya." },
          { title: "Sebutkan dampaknya", body: "Apakah pekerjaan berhenti total atau masih ada jalan lain. Ini menentukan urutan penanganan oleh admin." },
        ]),
      ],
    },

    /* ---------------------------------------------------------------- 15 */
    {
      num: "15",
      title: "Kebiasaan kerja yang baik",
      kicker: "Penutup",
      blocks: [
        para("Aplikasi hanya sebaik kebiasaan orang yang memakainya. Sebelas kebiasaan berikut menjaga angka di dalamnya tetap dapat dipercaya."),
        bullets([
          "Catat nota pada hari yang sama. Semakin lama jeda, semakin besar kemungkinan bukti hilang.",
          "Selalu isi nomor nota dan merchant. Dua kolom ini yang membuat pencocokan bukti mungkin dilakukan.",
          "Pilih kategori biaya dengan sadar. Kategori menentukan pos anggaran mana yang terpakai.",
          "Jangan menunda persetujuan. Antrean yang menumpuk membuat biaya aktual terlambat tercatat dan margin terlihat lebih baik dari kenyataan.",
          "Tulis alasan yang bisa dibaca orang lain, bukan singkatan pribadi.",
          "Periksa pos anggaran sebelum menyetujui pengeluaran yang membuat pos melewati 100 persen.",
          "Jangan memakai change order untuk menutupi kesalahan pencatatan. Perbaiki catatannya.",
          "Terbitkan dokumen hanya setelah datanya benar. Dokumen final tidak dapat ditarik kembali.",
          "Perbarui progres lapangan minimal sekali seminggu, atau setiap kali ada peristiwa penting.",
          "Biasakan membaca Ikhtisar setiap pagi. Tiga menit membaca antrean Perlu tindakan mencegah pekerjaan menumpuk.",
          "Simpan bukti nota asli. Aplikasi menyimpan salinan, tetapi dokumen fisik sering masih diminta saat audit.",
        ]),
        h2("Kapan meminta bantuan"),
        bullets([
          "Ada angka yang menurut Anda tidak mungkin, dan Anda sudah memeriksa filter serta keanggotaan proyek.",
          "Sebuah tombol tidak berfungsi pada dua peramban berbeda.",
          "Muncul halaman galat dengan kode kejadian.",
          "Anda perlu izin atau peran tambahan untuk menyelesaikan pekerjaan.",
        ]),
        para("Sampaikan kepada admin proyek disertai kode pengeluaran atau nomor dokumen yang bermasalah, agar penelusuran dapat langsung dilakukan pada data yang tepat."),
      ],
    },
  ],
};
