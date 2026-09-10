# PRD - Modul Payroll Karyawan Inhouse
Sistem HRIS (Dokumen Pendamping, Fokus Payroll)

| Field | Detail |
| :--- | :--- |
| **Dokumen** | PRD Khusus - Modul Payroll (Karyawan Inhouse) |
| **Versi** | 1.0 |
| **Tanggal** | Agustus 2026 |
| **Terkait dengan** | Pilar 3 (Payroll)<br>PRD Utama HRIS |
| **Target Pembaca** | Programmer/Engineer (IT), Product Owner, HR/Finance |

| Ruang Lingkup | Detail |
| :--- | :--- |
| **Termasuk** | Payroll karyawan inhouse saja. |
| **Tidak Termasuk** | BPJS Kesehatan/Ketenagakerjaan, Payment freelance per-event, dan integrasi API perbankan tidak termasuk versi ini (lihat Section 9 - Out of Scope). |

---

## 1. Tujuan Dokumen
Dokumen ini menjelaskan apa yang harus dibangun untuk modul payroll dan kenapa termasuk konsep dasar penggajian & perpajakan Indonesia yang relevan, supaya tim IT yang mengerjakan tidak perlu punya latar belakang HR/payroll sebelumnya untuk memahami logika di baliknya. Dokumen ini melengkapi PRD Utama HRIS, bukan menggantikannya.

Cara membaca dokumen ini: Section 2 menjelaskan konsep dasar dulu (istilah, aturan pajak) sebelum masuk ke requirement teknis di Section 3 dst supaya saat membaca requirement, sudah paham konteksnya.

## 2. Konsep Dasar yang Perlu Dipahami Tim IT

### 2.1 Istilah Kunci

| Istilah | Penjelasan |
| :--- | :--- |
| **Gaji Bruto** | Total penghasilan sebelum dipotong pajak/potongan lain (gaji pokok + semua tunjangan + lembur + insentif). |
| **PPh 21** | Pajak Penghasilan Pasal 21 pajak yang dipotong perusahaan dari gaji karyawan setiap bulan, disetorkan ke negara atas nama karyawan. |
| **PTKP** | Penghasilan Tidak Kena Pajak batas penghasilan tahunan yang bebas pajak, besarnya tergantung status pernikahan & jumlah tanggungan karyawan. |
| **TER (Tarif Efektif Rata-rata)** | Metode resmi (berlaku sejak 2024, masih berlaku 2026) untuk menghitung PPh 21 bulanan secara simpel: cukup kalikan gaji bruto bulanan dengan satu angka persentase, tanpa hitung manual PTKP/biaya jabatan tiap bulan. |
| **Take Home Pay (Netto)** | Gaji bruto dikurangi PPh 21 dan potongan lain inilah nominal yang benar-benar diterima/ditransfer ke karyawan. |
| **Pro-rata** | Perhitungan gaji yang disesuaikan proporsional, dipakai saat karyawan baru join atau resign di tengah bulan (tidak dapat gaji penuh 1 bulan). |
| **Payroll Run / Periode Payroll** | Satu siklus proses payroll untuk 1 bulan tertentu, mencakup semua karyawan. |

### 2.2 Kenapa Perhitungan Pajak Tidak Bisa Di-hardcode Sembarangan
Ini bagian yang paling penting dipahami tim IT: PPh 21 bukan angka tetap dia bergantung pada:
1. Berapa gaji bruto bulanan karyawan (semakin besar, semakin besar tarifnya sifatnya progresif).
2. Status PTKP karyawan (kawin/tidak, jumlah tanggungan) semakin banyak tanggungan, semakin besar batas bebas pajaknya, jadi pajak yang dipotong semakin kecil untuk gaji yang sama.

Karena itu, sistem tidak boleh menyimpan persentase pajak sebagai angka tetap di dalam kode program (hardcoded). Tarif ini berasal dari tabel resmi pemerintah (PMK 168/2023) yang bisa berubah sewaktu-waktu kalau ada revisi regulasi. Solusinya: tarif ini disimpan sebagai data konfigurasi di database (lihat Section 4.4), bukan logic di kode supaya kalau tarif berubah, HR/Admin cukup update data, tidak perlu minta IT ubah & deploy ulang aplikasi.

> **PENTING:** Angka contoh perhitungan pajak di dokumen ini (Section 5) adalah ILUSTRASI untuk membantu memahami mekanismenya, bukan tarif resmi yang boleh langsung dipakai di sistem produksi. Tabel tarif resmi (persentase TER per kategori & per lapisan penghasilan) wajib dikonfirmasi ke akuntan/konsultan pajak mengacu ke Lampiran PMK 168/2023 sebelum go-live. Ini murni pertimbangan kepatuhan hukum kesalahan di tabel ini berisiko ke kepatuhan pajak perusahaan.

### 2.3 Status PTKP

| Status | Keterangan | PTKP Tahunan (Rp) |
| :--- | :--- | :--- |
| **TK/0** | Tidak kawin, 0 tanggungan | 54.000.000 |
| **TK/1** | Tidak kawin, 1 tanggungan | 58.500.000 |
| **TK/2** | Tidak kawin, 2 tanggungan | 63.000.000 |
| **TK/3** | Tidak kawin, 3 tanggungan | 67.500.000 |
| **K/0** | Kawin, 0 tanggungan | 58.500.000 |
| **K/1** | Kawin, 1 tanggungan | 63.000.000 |
| **K/2** | Kawin, 2 tanggungan | 67.500.000 |
| **K/3** | Kawin, 3 tanggungan | 72.000.000 |

*(Nilai dasar ini sudah tidak berubah sejak 2016 dan masih berlaku di 2026 - tapi tetap perlu dikonfirmasi ulang saat implementasi, karena regulasi bisa berubah kapan saja.)*

**Aturan penting untuk desain sistem:**
Status PTKP ditentukan berdasarkan kondisi karyawan per tanggal 1 Januari tahun berjalan, dan berlaku tetap sepanjang tahun itu walaupun status pernikahan karyawan berubah di tengah tahun (misal menikah bulan Juni), perhitungan pajaknya tetap pakai status lama sampai akhir tahun tersebut.
Implikasi ke sistem: field Status PTKP tidak boleh langsung di-overwrite saat HR update data karyawan. Sistem perlu menyimpan riwayat Status PTKP per tahun pajak (contoh: karyawan A berstatus TK/0 di tahun 2026, lalu K/0 mulai tahun 2027), bukan cuma satu nilai yang ditimpa terus.

### 2.4 Mekanisme Perhitungan PPh 21 Bulanan (TER)
Alurnya simpel secara konsep:
1. Tentukan Kategori TER karyawan (Kategori A/B/C) berdasarkan Status PTKP-nya - ini mapping tetap dari tabel resmi.
2. Tiap bulan (Januari-November): PPh 21 = Gaji Bruto Bulan Ini × Tarif TER
   - tarif ini didapat dari tabel yang mengelompokkan Gaji Bruto ke dalam "lapisan" (bracket) tertentu per kategori.
3. Bulan Desember beda mekanisme ini yang sering jadi sumber bug kalau tidak diantisipasi dari desain awal:
   - Hitung ulang total PPh 21 setahun penuh menggunakan tarif progresif resmi (5%-35% dari Penghasilan Kena Pajak tahunan).
   - Bandingkan dengan total PPh 21 yang sudah dipotong Januari-November.
   - Selisihnya (kurang bayar → potong tambahan di Desember; lebih bayar → dikembalikan ke karyawan) itulah PPh 21 yang tertera di slip gaji Desember.

Kenapa ini penting untuk desain database: sistem payroll perlu bisa menjumlahkan seluruh PPh 21 yang sudah dipotong dari Januari sampai November untuk karyawan tertentu, supaya bisa dipakai di perhitungan Desember. Artinya histori payroll per bulan per karyawan harus tersimpan terstruktur (bukan cuma generate PDF lalu datanya hilang), karena akan di-query lagi di akhir tahun.

### 2.5 Pemetaan Status PTKP ke Kategori TER
Kategori TER (A/B/C) ditentukan dari Status PTKP karyawan, dengan pemetaan sebagai berikut:

| Kategori TER | Status PTKP yang Masuk |
| :--- | :--- |
| **TER A** | TK/0, TK/1, K/0 |
| **TER B** | TK/2, TK/3, K/1, K/2 |
| **TER C** | K/3 |

Logikanya: semakin tinggi PTKP karyawan (karena status kawin dan/atau jumlah tanggungan), semakin tinggi kategorinya, dan semakin besar pula ambang penghasilan bulanan yang masih bebas pajak di kategori tersebut. Dua karyawan dengan gaji bruto sama tapi kategori TER berbeda bisa punya potongan PPh 21 yang berbeda.

> Pemetaan status-ke-kategori di atas relatif stabil karena sifatnya klasifikasi, tapi persentase tarif per lapisan penghasilan di dalam masing-masing kategori tetap wajib diambil dari tabel resmi (Lampiran PMK 168/2023) via akuntan/konsultan pajak bukan dari dokumen ini karena itu angka yang harus persis (lihat peringatan Section 2.2).

### 2.6 Catatan Penting: Lembur TIDAK Menghasilkan Komponen Payroll
Konfirmasi dari Product Owner: perusahaan saat ini tidak punya skema tunjangan/uang lembur. Kompensasi atas lembur diberikan dalam bentuk tambahan jatah cuti, bukan uang.

Implikasi untuk desain sistem:
* Modul Payroll tidak perlu field/komponen "Tunjangan Lembur" atau logika perhitungan uang lembur sama sekali di versi ini.
* Tapi lembur tetap perlu tercatat di sistem hanya saja outputnya masuk ke Fitur 2 (Izin & Cuti) sebagai penambahan kuota cuti, bukan ke Payroll. Ini berarti Fitur 2 perlu mengakomodasi jenis transaksi "penambahan kuota cuti dari kompensasi lembur" (selain pengurangan kuota karena cuti diambil).

Kenapa tetap perlu diberi tahu ke tim IT meski tidak dipakai sekarang: 
(1) supaya struktur datanya tidak menutup kemungkinan menambahkan komponen lembur berbasis uang di kemudian hari kalau kebijakan berubah - desain "Komponen Payroll sebagai daftar item yang bisa ditambah" di Section 4.2 sudah mengakomodasi ini tanpa perlu perubahan struktur; 
(2) supaya IT tidak salah asumsi dan membangun logika perhitungan lembur berbasis uang yang sebenarnya tidak dibutuhkan saat ini.

Field "Lembur" yang sebelumnya disebut sebagai data periodik payroll di versi draft dokumen ini dihapus dari Payroll lihat revisi Section 4.5.

## 3. Alur Proses Payroll (End-to-End)

| Langkah | Aktor | Sistem Melakukan Apa |
| :--- | :--- | :--- |
| **Cut-off data periodik** | HR | Memastikan input potongan lain, cuti tanpa gaji, reimbursement sudah lengkap sebelum tanggal cut-off (H-5). Tanggal cut-off periode penggajian adalah batas akhir waktu pengumpulan dan penguncian data absensi, lembur, serta komponen variabel lainnya sebelum proses payroll atau perhitungan gaji dilakukan. |
| **Generate draft payroll** | Sistem (otomatis) | Hitung Bruto → PPh 21 (via TER) → Potongan Lain → Netto, untuk semua karyawan aktif sekaligus. |
| **Review** | HR Staff | Cek draft, revisi kalau ada kesalahan input. |
| **Approval** | HR Lead | Approve payroll sebelum lanjut ke pembayaran. |
| **Eksekusi pembayaran** | HR Lead (manual, versi awal) | Sistem hasilkan rekap nominal per rekening karyawan → HR Lead upload ke internet banking secara manual. |
| **Konfirmasi payment** | HR Lead | Tandai di sistem bahwa transfer sudah dilakukan (+ tanggal). |
| **Generate slip gaji** | Sistem (otomatis) | Buat PDF slip gaji per karyawan begitu status payment dikonfirmasi. |
| **Distribusi slip** | Sistem (otomatis) | Kirim slip ke masing-masing karyawan (email/in-app). |
| **Simpan histori** | Sistem (otomatis) | Simpan data payroll periode ini secara terstruktur (bukan cuma file PDF) untuk dipakai lagi saat rekonsiliasi Desember & pelaporan pajak tahunan. |

## 4. Kebutuhan Data & Struktur (untuk Panduan Desain Database)
Ini bukan skema database final tapi daftar entitas & field yang perlu diakomodasi, supaya IT punya gambaran sebelum desain schema sendiri.

### 4.1 Data Master Karyawan (bagian yang relevan untuk Payroll)

| Field | Tipe/Format | Catatan |
| :--- | :--- | :--- |
| **Gaji Pokok** | Angka (Rupiah) | |
| **Status Kepegawaian** | Tetap/Kontrak/Probation | Bisa mempengaruhi hak atas komponen tertentu. |
| **Status PTKP** | TK/0 s.d. K/3 | Harus tersimpan per tahun pajak (lihat 2.3), bukan 1 nilai yang ditimpa. |
| **Jumlah Tanggungan** | Angka (maks 3 diakui pajak) | Dasar penentuan Status PTKP. |
| **NIK** | 16 digit | Sejak integrasi Coretax 2026, berfungsi sekaligus sebagai NPWP. |
| **Nomor Rekening & Nama Bank** | Teks | Untuk instruksi transfer. |
| **Tanggal Mulai Kerja** | Tanggal | Untuk pro-rata gaji bulan pertama. |
| **Tanggal Resign** | Tanggal (nullable) | Untuk pro-rata gaji bulan terakhir. |

### 4.2 Komponen Payroll (Master, bukan per-karyawan)
Disarankan didesain sebagai daftar item yang bisa ditambah, bukan kolom tetap di tabel karyawan supaya menambah jenis tunjangan/potongan baru (termasuk BPJS, atau tunjangan lembur kalau kebijakan berubah nanti) tidak perlu ubah struktur tabel.

| Field | Contoh Isi (disesuaikan template slip yang sudah dipakai - lihat Section 6) |
| :--- | :--- |
| **Nama Komponen** | Gaji Pokok, Tunjangan Pajak (PPh), Komisi dll, Tunjangan Lainnya (Fee Event), Bonus/THR dan sejenisnya, Potongan Pajak (PPh), Potongan Lainnya (Kasbon) |
| **Kategori** | Pendapatan / Potongan |
| **Sifat** | Tetap / Tidak Tetap |
| **Kena Pajak?** | Ya/Tidak |

> Konfirmasi status saat ini: perusahaan belum punya Tunjangan Jabatan, Tunjangan Makan, atau Tunjangan Transport yang berjalan jadi komponen-komponen ini tidak perlu dibangun sebagai data aktif di versi awal. Cukup pastikan desain "Komponen Payroll" fleksibel (poin di atas) supaya gampang ditambahkan kalau kebijakan ini mulai berlaku nanti. Tunjangan Lembur juga tidak ada lihat Section 2.6.

### 4.3 Data Per-Karyawan Per-Komponen
Menyimpan nominal spesifik tiap karyawan untuk tiap komponen yang benar-benar aktif dipakai (mengacu ke daftar komponen riil di 4.2 - bukan Tunjangan Jabatan/Transport/Makan yang belum berlaku).

### 4.4 Tabel Konfigurasi Tarif Pajak (TER)
Ini yang paling kritis untuk didesain fleksibel (lihat Section 2.2):

| Field | Contoh | Catatan |
| :--- | :--- | :--- |
| **Kategori TER** | A/B/C | |
| **Batas Bawah Bruto** | Rp5.400.000 | |
| **Batas Atas Bruto** | Rp5.650.000 | |
| **Tarif (%)** | 0,25% | (ilustrasi, bukan angka resmi) |
| **Tahun Berlaku** | 2026 | |

Disimpan sebagai data (bisa diedit lewat admin panel), bukan hardcode di kode program dan punya "Tahun Berlaku" supaya kalau tarif berubah tahun depan, tabel lama tetap tersimpan untuk keperluan audit/rekonsiliasi data lama.

### 4.5 Data Periodik per Payroll Run

| Field | Sumber |
| :--- | :--- |
| **Periode (bulan/tahun)** | Input HR saat mulai payroll run |
| **Insentif/Bonus** | Input manual HR Lead |
| **Potongan lain (kasbon, dll)** | Input manual HR Lead |
| **Status Payroll Run** | Draft → Direview → Diapprove HR Lead → Dibayar → Slip Terdistribusi |

### 4.6 Hasil Perhitungan per Karyawan per Periode (harus tersimpan permanen)
Bruto, PPh 21, Total Potongan, Netto - disimpan sebagai data terstruktur (bukan cuma di dalam file PDF slip), karena akan di-query lagi untuk rekonsiliasi Desember dan pelaporan pajak tahunan (bukti potong 1721-A1).

## 5. Contoh Perhitungan (Ilustrasi)
> Angka tarif pajak di contoh ini ilustratif, bukan tarif resmi lihat peringatan di Section 2.2. Contoh ini juga memakai komponen yang benar-benar aktif saat ini (bukan Tunjangan Jabatan/Transport/Makan yang belum berlaku lihat Section 4.2).

Kasus: Karyawan dengan Gaji Pokok Rp8.000.000, Tunjangan Lainnya/Fee Event bulan ini Rp1.500.000, Status TK/0 (Kategori TER A, misal tarif ilustratif 2%), tidak ada potongan lain bulan ini.

| Komponen | Nominal |
| :--- | :--- |
| **Gaji Pokok** | Rp8.000.000 |
| **Tunjangan Lainnya (Fee Event)** | Rp1.500.000 |
| **Gaji Bruto** | Rp9.500.000 |
| **PPh 21 (ilustrasi: 2% × Bruto)** | Rp190.000 |
| **Potongan Lain** | Rp0 |
| **Gaji Bersih (Take Home Pay)** | Rp9.310.000 |

* **Contoh pro-rata:** Karyawan join tanggal 10 di bulan yang punya 30 hari kalender → bekerja 21 hari dari 30 hari → Gaji Pokok bulan pertama = (21/30) × Rp8.000.000 = Rp5.600.000 (baru dilanjut hitung komponen lain & pajak dari angka ini).
* **Contoh mekanisme Desember (konsep, bukan angka final):** Jika total PPh 21 yang sebenarnya harus dibayar setahun (dihitung ulang pakai tarif progresif atas total penghasilan setahun) adalah Rp23.000.000, sementara yang sudah dipotong Januari-November totalnya Rp20.900.000 → maka PPh 21 yang dipotong di slip Desember = Rp23.000.000 - Rp20.900.000 = Rp2.100.000 (lebih besar dari bulan-bulan biasa, ini normal dan perlu dijelaskan ke karyawan agar tidak dikira error sistem).

## 6. Format Slip Gaji
Status: sudah ada template existing, dikonfirmasi oleh perusahaan. Berikut struktur field-nya persis sesuai template yang dipakai:

| Bagian | Isi |
| :--- | :--- |
| **Header Perusahaan** | Nama Perusahaan, Alamat Perusahaan disarankan disimpan sebagai data konfigurasi perusahaan di sistem (settings), bukan hardcode di template PDF, supaya kalau alamat/nama berubah tidak perlu ubah kode. |
| **Judul** | "SLIP GAJI [BULAN] [TAHUN]" |
| **Kotak Info Slip** | Nama Perusahaan & Alamat (diulang), Nomor slip (lihat catatan penomoran di bawah). |
| **Data Pegawai** | Nama Pegawai, Jabatan, Alamat, Periode. |
| **PENGHASILAN** | Gaji Pokok, Tunjangan Pajak (PPh), Komisi dll, Tunjangan Lainnya (Fee Event), Bonus/THR dan sejenisnya → Jumlah Penghasilan. |
| **POTONGAN** | Potongan Pajak (PPh), Potongan Lainnya (Kasbon) → Jumlah Potongan. |
| **Ringkasan** | Take Home Pay = Jumlah Penghasilan - Jumlah Potongan. |
| **Terbilang** | Nominal Take Home Pay ditulis ulang dalam kata (mis. "Sembilan juta tiga puluh sembilan ribu rupiah") butuh fitur konversi angka-ke-kata Bahasa Indonesia, lihat catatan teknis di bawah. |
| **Catatan Kaki** | Disclaimer soal Natura/Kenikmatan & status PPh (lihat catatan penting di bawah teks ini kemungkinan berubah tergantung kebijakan pajak yang berlaku, jadi sebaiknya bukan teks tetap di template). |
| **Tanda Tangan** | Nama Departemen (mis. "HRGA DEPARTMENT") & Nama Perusahaan. |

*(Catatan untuk IT: struktur DATA di Section 4 sudah selaras dengan field-field di atas data model bisa langsung dipetakan ke template ini.)*

### 6.1 Catatan Teknis: Fitur "Terbilang"
Sistem perlu fungsi konversi angka menjadi teks Bahasa Indonesia (mis. 9.039.000 → "sembilan juta tiga puluh sembilan ribu rupiah"). Ini fitur umum di payroll Indonesia disarankan pakai library/fungsi "terbilang" yang sudah banyak tersedia open-source (untuk PHP, JS, dll), tidak perlu dibuat dari nol.

### 6.2 Mekanisme PPh "DTP" (Ditanggung Pemerintah)
Template ini mencantumkan catatan kaki:
"PPh ditampilkan sebagai pajak terutang. Pada periode ini PPh bersifat DTP (Ditanggung Pemerintah), sehingga pemotongan pajak hanya berlaku bagi karyawan dengan penghasilan di atas Rp10.000.000"

Konfirmasi dari Product Owner: slip tetap menampilkan Potongan Pajak (PPh) sesuai perhitungan normal ini untuk keperluan transparansi/pelaporan, karena karyawan tetap perlu tahu PPh terutangnya (misal untuk SPT Tahunan pribadi mereka). Tapi secara riil, nominal itu tidak benar-benar dipotong dari yang ditransfer ke rekening karyawan, karena pajaknya ditanggung pemerintah (DTP) - karyawan tetap menerima full gross.

Keputusan: format slip TIDAK diubah tetap mengikuti template yang sudah ada apa adanya (Potongan Pajak tetap tampil mengurangi angka Take Home Pay yang tercetak, seperti contoh di Section 6).

Implikasi teknis yang tetap harus diperhatikan tim IT (ini bukan soal tampilan slip, tapi soal proses pembayaran di baliknya lihat Section 3, langkah 5 "Eksekusi Pembayaran"):
Karena Take Home Pay yang tercetak di slip bisa berbeda dari nominal yang benar-benar perlu ditransfer ke rekening karyawan saat DTP aktif, sistem tidak boleh otomatis memakai angka "Take Home Pay" di slip sebagai acuan nominal transfer. Perlu dua nilai yang disimpan terpisah per karyawan per periode:
1. **Take Home Pay** (tercetak di slip) hasil Jumlah Penghasilan dikurangi Jumlah Potongan, sesuai format existing.
2. **Nominal Transfer Riil** nominal yang benar-benar diinstruksikan ke Finance untuk ditransfer, yang saat DTP aktif = Jumlah Penghasilan penuh (potongan pajaknya tidak ikut mengurangi).

Perlu dikonfirmasi ke HR/Finance: apakah aturannya selalu "saat DTP aktif, Nominal Transfer Riil = Jumlah Penghasilan penuh tanpa potongan pajak", atau ada kondisi tertentu yang tetap dipotong meski DTP aktif? -> Ketika total THP nya lebih dari 10 juta, DTP tidak aktif, jadi tetap ada potongannya.

### 6.3 Field yang Perlu Diklarifikasi Fungsinya
* "Tunjangan Pajak (PPh)" (bagian Penghasilan) - apakah ini tunjangan gross-up (tambahan yang diberikan perusahaan untuk menutup beban pajak karyawan, dipakai saat skema bukan DTP)? Kalau iya, ini butuh logic perhitungan tersendiri (gross-up bersifat iteratif karena tunjangan ini sendiri ikut kena pajak).
* "Komisi, dll" dan "Bonus, THR, dan sejenisnya" - apakah selalu input manual nominalnya oleh HR/Finance tiap periode, atau ada aturan/rumus otomatis?
* Penomoran "Nomor" slip - apakah nomor urut reset tiap bulan (mulai dari 1 lagi tiap periode baru), atau berkelanjutan sepanjang tahun/selamanya?

## 7. Keamanan & Akses Data Payroll
Data payroll adalah data paling sensitif di seluruh sistem HRIS (nominal gaji, nomor rekening) perlu perhatian khusus:
* Akses terbatas ketat: hanya Admin, HR Lead (input/proses), HR Lead (approve) yang bisa lihat detail payroll semua karyawan. Karyawan hanya bisa lihat slip gajinya sendiri.
* Pertanyaan terbuka soal GM: apakah GM perlu melihat detail gaji per-individu, atau cukup angka agregat (total biaya payroll bulanan/departemen) tanpa rincian per orang? -> detail gaji per individu dan summarynya.
* Audit trail wajib: setiap perubahan data master payroll (gaji pokok, tunjangan, status PTKP) harus tercatat siapa yang ubah, kapan, dan nilai sebelum/sesudahnya.
* Enkripsi: nomor rekening bank & nominal gaji sebaiknya terenkripsi di database (at-rest), tidak disimpan sebagai plain text.

## 8. Pertanyaan yang Perlu Dikonfirmasi Sebelum/Selama Development

| # | Topik | Keputusan | Lihat |
| :--- | :--- | :--- | :--- |
| **1** | Nominal Transfer Riil saat DTP | Threshold Rp10 juta - di atas itu pajak beneran dipotong, di bawah/sama dengan itu DTP (tidak dipotong riil) | 6.2 |
| **2** | Field "Tunjangan Pajak (PPh)" | Skema Gross-Up; butuh field "Skema PPh" per karyawan | 4.1, 6.3 |
| **3** | Pengisian Komisi/Bonus/THR | Manual, tanpa rumus otomatis | 6.3 |
| **4** | Penomoran slip | Reset tiap bulan | 6.3 |
| **5** | Catatan kaki slip | Harus bisa diedit per periode (data konfigurasi, bukan teks tetap) | 6.3 |
| **6** | Cut-off data periodik | H-5 dari tanggal pembayaran gaji | 3 |
| **8** | Skema approval | Cukup HR Lead; GM cukup terinfo/notifikasi | 3 |
| **9** | Visibilitas GM | Agregat DAN detail per-individu | 7 |
| **12** | THR | Diproses terpisah di luar sistem untuk versi awal, tapi nominalnya tetap muncul di slip gaji (input manual) | 6.3 |

## 9. Out of Scope (Versi Ini)
* Tunjangan/uang lembur perusahaan tidak punya skema ini; kompensasi lembur berupa tambahan kuota cuti, ditangani di Fitur 2 (Izin & Cuti), bukan Payroll (lihat Section 2.6).
* Subsidi perjalanan dinas (uang transport, uang makan, uang saku saat dinas) dibukukan sebagai biaya operasional perusahaan, bukan lewat payroll/slip gaji, sehingga tidak perlu diakomodasi di modul ini sama sekali (bukan cuma ditunda memang di luar sistem payroll).
* BPJS Kesehatan & Ketenagakerjaan - perusahaan belum mendaftarkan; struktur data (Section 4.2) sudah dirancang supaya gampang ditambah nanti tanpa bongkar ulang.
* Payment freelance per-event - dibahas terpisah, alurnya beda (bukan siklus bulanan).
* Integrasi API perbankan otomatis versi ini masih upload manual ke internet banking oleh Finance.
* Potongan berbasis absensi/keterlambatan modul absensi belum ada di scope HRIS saat ini.
* Pelaporan pajak otomatis ke Coretax/DJP versi ini fokus ke perhitungan & slip gaji internal dulu; integrasi pelaporan pajak bisa jadi pengembangan lanjutan.

## 10. Template Slip
https://docs.google.com/document/d/1WLEVwwl_V6GfkscwzDbN5IhoRh2ISK2506HK54gRDOK/edit?usp=sharing

*(Catatan: Penggajian belum based on kehadiran, jadi gaperlu integrate dengan kehadiran)*
