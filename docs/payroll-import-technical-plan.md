# Rencana Teknis: Impor Payroll dari Excel

Status: **disetujui.** Tahap 1–3 selesai (backend + layar impor); tahap 4 (uji bersama HR dengan data nyata) belum.

HR menghitung gaji bulanan di Excel ("Payroll Template.xlsx"). Supaya tidak input dua kali, HRIS membaca file itu, lalu menyimpan hasilnya sebagai payroll periode untuk slip gaji, rekap, dan alur setuju → bayar → kunci.

## 1. Keputusan yang sudah disepakati

| # | Pertanyaan | Keputusan |
| :-- | :-- | :-- |
| 1 | Format file | File HR **apa adanya** (sheet "Template"), bukan template buatan HRIS |
| 2 | Freelancer (baris FLC) | **Tahap 2.** Tahap 1 hanya in-house; baris FLC ditampilkan sebagai "dilewati" |
| 3 | Rincian di slip | **Ya**, slip menampilkan rincian per komponen |
| 4 | Tunj Lainnya (Fee Event) | **Ikut ditransfer** bersama gaji |
| 5 | Komisi KTNA Agro | **Masuk THP** |
| 6 | Kasbon | **Memotong THP** |

Keputusan 4–6 berarti rumus THP di Excel yang sekarang (`=SUM(F:J)`) keliru. Akibatnya, HRIS **tidak memakai kolom THP dari Excel**, tapi menghitung ulang THP dari komponennya (lihat bagian 2).

## 2. Aturan hitung

Angka input diambil dari Excel. Rumus akhirnya diterapkan HRIS supaya konsisten untuk semua baris.

| Nilai | Sumber |
| :-- | :-- |
| Pendapatan | Kolom Gapok + semua kolom Komisi + Tunj Lainnya (nilai > 0) |
| Bruto | Jumlah pendapatan (dihitung HRIS; dibandingkan dengan kolom "Total Penghasilan Bruto") |
| PPh 21 | Kolom "PPH 21 TERUTANG SEBULAN" **apa adanya** (tidak dihitung ulang HRIS) |
| Kasbon | Kolom "Jumlah Kasbon" |
| THP | Bruto − Kasbon − PPh 21 |
| Transfer | THP; **+ PPh 21 kalau DTP** (PPh tercetak di slip tapi tidak dipotong dari transfer) |
| DTP | Aturan yang sama dengan engine HRIS: PPh > 0 dan THP ≤ ambang DTP (Pajak → Ambang THP, sekarang Rp10.000.000) — **lihat pertanyaan T1** |

Kolom "SUBMIT PAYROLL" (THP versi Excel) hanya dipakai sebagai pembanding. Kalau berbeda dari THP hitungan HRIS, baris itu ditandai peringatan di pratinjau, tapi tetap memakai hitungan HRIS.

## 3. Cara membaca file

- **Sheet:** "Template". Kalau tidak ada, dipakai sheet pertama.
- **Baris judul:** baris yang berisi "INH/FLC" dan "NAMA" (sekarang baris 3). Posisinya dicari, bukan dikunci di baris 3.
- **Kolom dikenali dari judul, bukan huruf kolom.** Menyisipkan kolom tidak merusak impor.

  | Judul mengandung | Dipakai sebagai |
  | :-- | :-- |
  | `INH/FLC` | Jenis baris (INH = in-house, FLC = freelancer) |
  | `NAMA` | Nama untuk pencocokan |
  | `GAPOK` | Pendapatan: Gaji Pokok |
  | `KOMISI` (setiap kolom) | Pendapatan, nama baris slip diambil dari judul kolom, misalnya "Komisi Sales PENAS" |
  | `TUNJ LAINNYA` | Pendapatan: Tunjangan Lainnya (Fee Event) |
  | `TOTAL PENGHASILAN BRUTO` | Pembanding bruto |
  | `PPH 21` | PPh 21 |
  | `KASBON` | Potongan: Kasbon |
  | `SUBMIT PAYROLL` | Pembanding THP |
  | `FEE FREELANCE`, `KATEGORI TER`, `PERSENTASE TER`, `KET`, `JABATAN`, `LOKASI`, `PTKP` | Dibaca untuk tampilan pratinjau, tidak disimpan |

- **Kolom komisi event baru** (misalnya event baru bulan depan) otomatis dikenali selama judulnya diawali "Komisi".
- **Kolom berisi angka dengan judul yang tidak dikenali** tetap memunculkan peringatan "kolom X diabaikan", supaya tidak ada nominal yang hilang diam-diam.
- **Baris data** adalah baris yang kolom A-nya INH atau FLC. Baris total dan catatan di bawahnya otomatis terlewat.
- **Nilai rumus dibaca dari hasil yang tersimpan di file.** Kalau file belum pernah dibuka dan disimpan di Excel atau Google Sheets (nilai rumus kosong), impor ditolak dengan pesan yang jelas.

## 4. Pencocokan karyawan

File tidak punya ID karyawan, jadi pencocokan memakai nama.

1. Nama dinormalkan: huruf besar, tanda baca dan spasi ganda dibuang, teks dalam kurung seperti "(TEST)" diabaikan.
2. Satu karyawan aktif dengan nama yang sama persis dipasangkan otomatis.
3. Selain itu (beda ejaan, nama ganda, atau tidak ketemu), HR memilih karyawan secara manual di pratinjau, dengan saran nama yang mirip.
4. Pasangan manual disimpan di tabel baru `PayrollImportAlias` (nama Excel → karyawan), jadi bulan berikutnya otomatis.
5. Satu karyawan tidak boleh dipasangkan ke dua baris dalam satu file (error).
6. Karyawan berstatus tidak aktif tetap boleh diimpor, tapi diberi peringatan.

## 5. Alur dan status periode

- Tambah field `PayrollPeriod.source`: `ENGINE` (dihitung HRIS, perilaku sekarang) atau `IMPORT`.
- Impor bisa dilakukan di periode **DRAFT** yang belum dihitung, atau periode `IMPORT` yang masih **CALCULATED/REVIEW**, untuk impor ulang.
- Impor **mengganti seluruh** payroll periode itu, lalu status menjadi CALCULATED. Setelah itu alurnya sama: Direview → Disetujui → Dibayar → Dikunci.
- Untuk periode `IMPORT`, tombol **Hitung** dan **Sync** engine disembunyikan dan ditolak di backend, supaya hasil impor tidak tertimpa engine.
- Tambah item manual tetap boleh sebelum dikunci, dengan rumus THP yang sama (bagian 2).
- Periode yang sudah dikunci tidak bisa diimpor ulang.

### Endpoint (stateless, tanpa file sementara)

| Endpoint | Fungsi |
| :-- | :-- |
| `POST /api/payroll/periods/{id}/import/preview/` (multipart: file) | Membaca file dan mengembalikan baris, hasil pencocokan, saran, error/peringatan per baris, baris FLC yang dilewati, dan total. Tidak menyimpan apa pun. |
| `POST /api/payroll/periods/{id}/import/` (multipart: file + `mappings` JSON) | Membaca ulang file yang sama dengan pasangan manual dari HR, memvalidasi, lalu menyimpan dalam satu transaksi. Ditolak kalau masih ada error. |

- **Hak akses:** sama dengan admin payroll, yaitu ADMIN dan HR_LEAD. GM tetap hanya bisa melihat.
- **Audit:** setiap impor dicatat (`log_event`) beserta nama file, jumlah baris, dan total transfer.

### Data yang disimpan per karyawan

- `Payroll`: `gross_salary`, `total_deduction`, `net_salary` (THP), `is_dtp`, `transfer_amount`, dan `basic_salary` (dari Gapok). Snapshot PTKP/TER dikosongkan.
- `PayrollItem` per komponen yang nilainya > 0, dengan `source = IMPORT` (pilihan baru) dan `payroll_component` kosong:
  - nama baris diambil dari judul kolom Excel, kode dibuat dari judul (misalnya `IMP_KOMISI_SALES_PENAS`);
  - kategori: Gapok = pendapatan tetap, komisi/tunjangan = pendapatan tidak tetap, kasbon = potongan;
  - PPh 21 disimpan sebagai potongan berkode `PPh21`, sama seperti engine, sehingga slip dan rekap tetap bekerja.

## 6. Slip gaji dan rekap

- Pembuat slip PDF sudah membaca `PayrollItem` secara umum (pendapatan vs potongan) dan memakai `net_salary` / `transfer_amount`. Slip hasil impor jadi **tidak perlu perubahan besar**: rincian per kolom Excel langsung tampil.
- Catatan DTP di slip tetap memakai ambang dari konfigurasi pajak.
- Rekap XLSX per periode tetap jalan karena sumber datanya sama.

## 7. Pratinjau (frontend)

Tombol **Impor dari Excel** ada di kartu periode (Proses payroll), untuk periode yang memenuhi syarat di bagian 5.

1. Unggah file `.xlsx`.
2. Ringkasan: jumlah baris in-house siap / perlu dipasangkan / error, baris FLC dilewati beserta totalnya, total bruto, PPh, transfer.
3. Tabel per baris berisi:
   - nama di Excel → karyawan HRIS (otomatis, atau dropdown kalau perlu dipasangkan);
   - Bruto, PPh, Kasbon, THP HRIS;
   - THP Excel dan selisihnya;
   - label DTP;
   - peringatan per baris.
4. Tombol **Simpan impor** aktif setelah tidak ada error dan semua baris in-house sudah terpasang.

### Validasi

- **Error (menolak impor):**
  - baris in-house belum terpasang ke karyawan;
  - satu karyawan dipasangkan ke dua baris;
  - nilai bukan angka atau negatif;
  - THP minus.
- **Peringatan (tetap boleh disimpan):**
  - THP Excel ≠ THP HRIS (sekarang akan sering muncul karena rumus Excel keliru);
  - bruto Excel ≠ jumlah komponen;
  - semua pendapatan 0;
  - karyawan tidak aktif;
  - kolom berangka yang tidak dikenali.

## 8. Tahapan implementasi

1. **Backend: parser dan pratinjau.** Membaca file, mengenali kolom, mencocokkan nama, dan menghitung (bagian 2–4). Endpoint preview, ditambah unit test memakai salinan template dengan data dummy.
2. **Backend: simpan impor.**
   - `PayrollPeriod.source`, `PayrollItem.Source.IMPORT`, model `PayrollImportAlias` (satu migrasi);
   - endpoint impor;
   - Hitung/Sync ditolak untuk periode `IMPORT`;
   - audit log;
   - test: slip PDF dan rekap dari periode hasil impor.
3. **Frontend:** tombol impor, layar pratinjau, pemasangan nama, simpan, dan label "Sumber: impor Excel" di kartu periode.
4. **Uji bersama HR:** impor satu bulan nyata, lalu bandingkan slip dengan perhitungan manual sebelum dipakai resmi.

Tahap 2 (terpisah): slip untuk freelancer (baris FLC), sekalian dengan keputusan payroll/fee freelance.

## 9. Keputusan tambahan (semua disetujui)

| # | Pertanyaan | Keputusan |
| :-- | :-- | :-- |
| T1 | Penentu DTP: catatan di Excel menyebut "Penghasilan di atas 10 jt = Non DTP" (berdasarkan **bruto**), sedangkan engine HRIS memakai **THP** ≤ ambang | Ikut Excel: **bruto ≤ ambang = DTP** (ambang dari Pajak → Ambang THP) |
| T2 | Simpan salinan file Excel yang diimpor di storage untuk jejak audit? | **Ya** |
| T3 | PPh 21 in-house di file sekarang kosong. Apakah HR akan mengisinya setiap bulan? | **Ya, HR mengisi.** Kalau kosong tetap dianggap 0, dengan peringatan di pratinjau |
| T4 | Struktur gaji, komponen, dan tabel TER HRIS tetap dipertahankan sebagai referensi? | **Ya**, tanpa perubahan |

## Progres

- **Tahap 1 (selesai):** `apps/payroll/excel_import.py` dan `POST /api/payroll/periods/{id}/import/preview/`. Tes ada di `apps/payroll/test_excel_import.py`. Sudah dicoba pada file asli HR: 19 kolom dikenali, terbaca 24 baris in-house dan 7 baris freelancer.
- **Tahap 2 (selesai):**
  - migrasi `payroll/0007_excel_import`: `PayrollPeriod.source`, `PayrollItem.Source.IMPORT`, `PayrollImportAlias`, `PayrollImport`;
  - endpoint `POST /api/payroll/periods/{id}/import/`;
  - Hitung/Sync ditolak untuk periode impor;
  - `refresh_payroll_totals` ikut menghitung komponen impor saat item manual ditambah;
  - salinan file disimpan di `employee-documents/payroll-imports/<tahun-bulan>/`;
  - audit log `payroll_import`;
  - serializer periode mengirim `source` dan `last_import`.
  - **Penyesuaian dari rencana:** impor ulang pada periode Direview **tidak** mengembalikan status ke Dihitung, karena alur status satu arah. Statusnya tetap Direview, dan HR mereview ulang datanya.
- **Tahap 3 (selesai):** di `features/payroll/payroll-page.tsx`, kartu periode punya tombol **Impor dari Excel** / **Impor ulang** yang membuka `PayrollImportPanel`:
  - unggah file, lalu ringkasan dan tabel per baris (pasangkan nama, error/peringatan, THP HRIS vs THP Excel);
  - tombol simpan;
  - label "Sumber: impor Excel" di kartu periode;
  - tombol Sync dan banner struktur gaji disembunyikan untuk periode impor.

## 10. Risiko

- **Judul kolom diganti** (misalnya "Jumlah Kasbon" menjadi "Pinjaman"): kolom tidak dikenali, lalu muncul peringatan "kolom diabaikan". Perlu kesepakatan dengan HR agar judul kolom tidak diubah tanpa kabar.
- **Nama karyawan di Excel berubah:** pasangan lama tidak cocok lagi, sehingga HR perlu memasangkan ulang di pratinjau (sekali saja).
- **PPh 21 sepenuhnya dari Excel:** kebenaran pajak tetap tanggung jawab HR/konsultan pajak. HRIS hanya menyimpan dan mencetaknya.
