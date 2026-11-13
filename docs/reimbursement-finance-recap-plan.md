# Rekap Reimbursement oleh Finance

Status: **disetujui dan diimplementasikan** (backend + frontend). Belum diuji di browser oleh HR/Finance.

Alur reimbursement (1–3) tidak berubah:

1. Karyawan mengajukan.
2. HR Staff mereview dan mengisi nominal disetujui.
3. HR Lead menyetujui, lalu HR menandai **Dibayar** (dengan bukti transfer).

Yang ditambahkan:

4. **Finance** mendapat notifikasi reimbursement yang sudah dibayar, lalu menandai masing-masing sebagai **sudah direkap**.

## Keputusan

| # | Pertanyaan | Keputusan |
| :-- | :-- | :-- |
| 1 | Peran Finance | Hanya merekap: tidak menyetujui, tidak mengubah nominal, tidak menandai Dibayar |
| 2 | Yang dilihat Finance | Hanya reimbursement berstatus **Dibayar** |
| 3 | Hak akses | **Tanda di Posisi** ("Akses Finance – rekap reimbursement" di Settings → Positions). Akun tetap role Employee. Akses mengikuti posisi karyawan saat ini |
| 4 | Satuan rekap | Per item |
| 5 | Pemberitahuan | Notifikasi di HRIS saja |
| F1 | Admin boleh merekap? | Ya |
| F2 | Siapa boleh membatalkan tanda? | Finance mana pun (tercatat di audit log) |
| F3 | Kartu di dashboard Finance? | Ya: "Rekap reimbursement · N belum direkap" |
| F4 | HR melihat status rekap? | Ya: "✓ Direkap Finance" di kolom Status (hanya lihat) |

Kenapa tanda di posisi, bukan role baru atau nama posisi: akun Finance tetap Employee, sehingga seluruh fitur karyawan tidak tersentuh. Akses juga tidak hilang kalau posisinya diganti nama, dan bisa diberikan ke lebih dari satu posisi.

## Implementasi

### Backend

- **Migrasi `personnel/0018`:** `Position.can_recap_reimbursement`.
- **Migrasi `reimbursement/0006`:** `Reimbursement.recapped_at` dan `recapped_by` (tanda, bukan status baru).
- **`permissions.can_recap(user)`:** ADMIN, atau karyawan yang posisinya dicentang.
- **Daftar dan akses data:**
  - `GET /api/reimbursements/?scope=recap` hanya mengembalikan yang PAID (summary dan export ikut);
  - Finance juga bisa membuka detail, lampiran, dan bukti transfer reimbursement PAID, tapi hanya baca (edit dan hapus ditolak).
- **Filter baru:** `?recapped=true|false` dan `?paid_month=YYYY-MM`.
- **Endpoint rekap:** `POST /api/reimbursements/{id}/recap/` dan `/unrecap/`, hanya untuk PAID, tercatat di audit log.
- **Notifikasi saat HR menandai Dibayar:** di lonceng HRIS untuk semua user Finance ("Reimbursement siap direkap"), mengikuti sakelar event "Reimbursement – Dibayar".
- **`/api/auth/me/`** mengirim `can_recap_reimbursement`.
- **Export XLSX** mendapat kolom "Direkap Finance".
- **Test:** `apps/reimbursement/test_finance_recap.py`.

### Frontend

- **Settings → Positions:** sakelar "Akses Finance" di form, dan badge "Finance · rekap" di tabel.
- **Sidebar:** user Finance mendapat menu **Finance → Rekap Reimbursement** (`/dashboard/employee/rekap-reimbursement`).
- **Halaman Rekap:**
  - kartu Belum/Sudah direkap (jumlah dan Rp);
  - filter Belum/Sudah/Semua, Departemen, Kategori, Bulan dibayar;
  - tabel dengan lampiran dan bukti transfer;
  - tombol Tandai direkap / Batalkan;
  - export XLSX;
  - tautan dari notifikasi (`?id=`).
- **Dashboard karyawan Finance:** kartu "Rekap reimbursement".
- **Halaman Reimbursement HR:** "✓ Direkap Finance" di bawah status.

## Cara mengaktifkan

1. Deploy (migrasi berjalan otomatis).
2. Settings → Positions → edit posisi **FAT Admin** → nyalakan **Akses Finance**.
3. Pastikan akun orang Finance terhubung ke data karyawannya, dengan posisi FAT Admin.
