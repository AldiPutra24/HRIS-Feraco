# Notifikasi HRIS Feraco (In-App & Email)

Dokumentasi lengkap sistem notifikasi HRIS Feraco: notifikasi **in-app** (lonceng/bell di header dashboard) dan **email** (SMTP). Ditujukan untuk developer yang memelihara kode dan HR/Admin yang mengonfigurasi notifikasi.

---

## Daftar Isi

1. [Gambaran Umum](#1-gambaran-umum)
2. [Arsitektur](#2-arsitektur)
3. [Model Data](#3-model-data)
4. [Katalog Event](#4-katalog-event)
5. [Penerima (Recipient Rules)](#5-penerima-recipient-rules)
6. [Idempotensi & Delivery Log](#6-idempotensi--delivery-log)
7. [Pengiriman Email (Async vs Sync)](#7-pengiriman-email-async-vs-sync)
8. [Template Email & Placeholder](#8-template-email--placeholder)
9. [Sanitasi HTML](#9-sanitasi-html)
10. [Notifikasi Terjadwal (Cron)](#10-notifikasi-terjadwal-cron)
11. [Reminder Task Freelance (Engine Terpisah)](#11-reminder-task-freelance-engine-terpisah)
12. [Notifikasi Legacy per Modul](#12-notifikasi-legacy-per-modul)
13. [API Reference](#13-api-reference)
14. [Frontend](#14-frontend)
15. [Konfigurasi SMTP & Environment](#15-konfigurasi-smtp--environment)
16. [Panduan HR/Admin](#16-panduan-hradmin)
17. [Troubleshooting](#17-troubleshooting)
18. [Testing](#18-testing)
19. [Menambah Event Baru (Checklist Developer)](#19-menambah-event-baru-checklist-developer)

---

## 1. Gambaran Umum

| Channel | Media | Dipicu oleh |
| --- | --- | --- |
| **In-app** | Bell di header dashboard (`NotificationBell`) | Aksi user (submit/approve/reject/review/paid) dan cron harian |
| **Email** | SMTP (`django.core.mail`) | Aksi user dan cron harian |

Ada **dua engine notifikasi**:

| Engine | Lokasi | Cakupan |
| --- | --- | --- |
| **Engine terpusat** | `backend/apps/notifications/` | Izin/Cuti, Reimbursement, End of Contract, Birthday — in-app + email, template dapat diedit, delivery log |
| **Engine task freelance** | `backend/apps/freelance/services.py` | Reminder deadline task freelance + eskalasi — email saja, template tetap (hard-coded) |

Prinsip desain engine terpusat:

- **Best-effort** — kegagalan notifikasi tidak pernah menggagalkan request utama (submit cuti, approve reimbursement, dll). Error ditangkap dan dicatat lewat `apps.audit.services.log_event`.
- **Idempoten** — setiap unit pengiriman punya `key` unik di `NotificationDeliveryLog`; aksi/cron yang diulang tidak mengirim dua kali.
- **Configurable** — HR/Admin bisa menyalakan/mematikan event, mengedit subject/body email, mengatur daftar email HR, offset kontrak, dan toggle birthday dari UI.

---

## 2. Arsitektur

```
 Aksi user (views)                         Cron harian
 ─────────────────                         ───────────
 apps/leaves/views.py                      manage.py send_employee_notifications
 apps/reimbursement/views.py                         │
        │                                            ▼
        ▼                                  services.run_all()
 apps/notifications/services.py  ◄──────── (contract + birthday)
   notify_leave_submitted / notify_leave_status
   notify_reimbursement_{submitted,reviewed,approved,rejected,paid}
        │
        ├─► In-app:  Notification row  ──► GET /api/notifications/ ──► NotificationBell (poll 60 dtk)
        │
        ├─► Email:   emails.render_email_parts() ──► _queue_email (async) / _send_email (sync) ──► SMTP
        │
        └─► NotificationDeliveryLog (key unik, status SENT/FAILED/SKIPPED)
```

File backend:

| File | Isi |
| --- | --- |
| `apps/notifications/models.py` | `Notification`, `NotificationEventConfig`, `NotificationSetting`, `NotificationDeliveryLog` |
| `apps/notifications/services.py` | Fungsi `notify_*`, resolusi penerima, idempotensi, pengiriman email, `run_all` (cron) |
| `apps/notifications/emails.py` | `AVAILABLE_PLACEHOLDERS`, `DEFAULT_TEMPLATES`, `render_email_parts`, `fmt_date` |
| `apps/notifications/sanitize.py` | Whitelist sanitizer HTML, `html_to_text`, `is_rich_html` |
| `apps/notifications/serializers.py` | Validasi settings & event config |
| `apps/notifications/views.py` | ViewSet API + permission `IsHRAdmin` + `EVENT_KEYS` + `PREVIEW_CONTEXT` |
| `apps/notifications/urls.py` | Router di bawah `/api/notifications/` |
| `apps/notifications/management/commands/send_employee_notifications.py` | Command cron |
| `apps/notifications/tests.py` | Test suite |

Migrasi: `0001` (awal), `0002` (event `REIMBURSEMENT_SUBMITTED`), `0003` (event stage reimbursement: reviewed/approved/rejected/paid).

---

## 3. Model Data

### 3.1 `Notification` — notifikasi in-app

Satu baris = satu item di bell milik satu user.

| Field | Tipe | Keterangan |
| --- | --- | --- |
| `recipient` | FK User (CASCADE) | Pemilik notifikasi |
| `kind` | Char(32), choices | Lihat tabel di bawah |
| `title` | Char(255) | Judul singkat |
| `message` | Text | Isi notifikasi |
| `link` | Char(512) | Path frontend untuk navigasi saat diklik, mis. `/dashboard/leave` |
| `object_id` | Char(64) | ID objek terkait (leave/reimbursement/contract/employee) |
| `is_read` | Bool | Status sudah dibaca |
| `created_at` | DateTime | Waktu dibuat |

`kind` choices:

| Kind | Label |
| --- | --- |
| `LEAVE_SUBMITTED` | Izin/Cuti - Pengajuan Baru |
| `LEAVE_APPROVED` | Izin/Cuti - Disetujui |
| `LEAVE_REJECTED` | Izin/Cuti - Ditolak |
| `REIMBURSEMENT_SUBMITTED` | Reimbursement - Pengajuan Baru |
| `REIMBURSEMENT_REVIEWED` | Reimbursement - Menunggu Approval HR Lead |
| `REIMBURSEMENT_APPROVED` | Reimbursement - Disetujui |
| `REIMBURSEMENT_REJECTED` | Reimbursement - Ditolak |
| `REIMBURSEMENT_PAID` | Reimbursement - Dibayar |
| `CONTRACT` | End of Contract |
| `BIRTHDAY` | Birthday |

### 3.2 `NotificationEventConfig` — konfigurasi per event email

| Field | Keterangan |
| --- | --- |
| `event` | Unique, salah satu dari 11 event key (lihat §4) |
| `enabled` | Matikan = email event ini tidak dikirim |
| `subject` | Subject custom; kosong = pakai default |
| `body` | Body custom (plain text atau rich HTML); kosong = pakai default |
| `updated_at` | Waktu terakhir diubah |

Baris untuk ke-11 event dibuat otomatis saat endpoint `GET /api/notifications/notification-events/` dipanggil.

### 3.3 `NotificationSetting` — singleton (pk=1)

| Field | Default | Keterangan |
| --- | --- | --- |
| `default_hr_emails` | `hrgaferaco@gmail.com` | Daftar email HR, dipisah koma |
| `additional_hr_users` | — | M2M User (hanya role `HR_STAFF`/`HR_LEAD`); email mereka ditambahkan ke daftar email HR |
| `birthday_hr_h1_enabled` | `True` | Email info ulang tahun ke HR pada H-1 |
| `birthday_hr_h0_enabled` | `True` | Email info ulang tahun ke HR pada H-0 (hari-H) |
| `birthday_employee_h1_enabled` | `False` | Ucapan (email + bell) ke karyawan pada H-1 |
| `birthday_employee_h0_enabled` | `True` | Ucapan (email + bell) ke karyawan pada H-0 |
| `contract_offsets` | `30,14,7,3,1,0` | Hari sebelum `end_date` kontrak untuk mengirim reminder |
| `updated_by` | — | User yang terakhir mengubah |

**Daftar email HR** (dipakai berbagai event) = `default_hr_emails` + email `additional_hr_users`, di-dedupe.

### 3.4 `NotificationDeliveryLog` — log + kunci idempotensi

| Field | Keterangan |
| --- | --- |
| `key` | **Unique**. Identitas pengiriman (lihat §6) |
| `channel` | `EMAIL` / `IN_APP` |
| `event` | Kind event |
| `recipient_email` | Alamat email (untuk channel EMAIL) |
| `recipient` | FK User (SET_NULL), untuk in-app atau bila email cocok dengan user |
| `subject` | Subject email terkirim |
| `status` | `SENT` / `FAILED` / `SKIPPED` |
| `detail` | Pesan error / alasan skip |
| `created_at` | Waktu |

---

## 4. Katalog Event

Ada **11 event key** (`EVENT_KEYS` di `views.py`) yang masing-masing punya template email dan toggle `enabled`.

| Event key | Pemicu | In-app (bell) ke | Email ke | Link bell |
| --- | --- | --- | --- | --- |
| `LEAVE_SUBMITTED` | Karyawan submit izin/cuti (`LeaveRequestViewSet.perform_create`) | Manager (Reporting To) + semua `ADMIN`, `HR_STAFF`, `HR_LEAD`, superuser aktif — **kecuali pemohon sendiri** | Manager + daftar email HR | Manager: `/dashboard/management/leave`; HR/Admin: `/dashboard/leave` |
| `LEAVE_APPROVED` | Leave di-approve | Karyawan pemohon | Karyawan pemohon | `/dashboard/employee/leave` |
| `LEAVE_REJECTED` | Leave di-reject (memuat alasan penolakan) | Karyawan pemohon | Karyawan pemohon | `/dashboard/employee/leave` |
| `REIMBURSEMENT_SUBMITTED` | Karyawan submit reimbursement | `HR_STAFF` + `ADMIN` (+ superuser) | Daftar email HR | `/dashboard/reimbursements?id={id}` |
| `REIMBURSEMENT_REVIEWED` | HR Staff/Admin review → status `WAITING_HR_LEAD` | `HR_LEAD` + `ADMIN` (+ superuser) | — (tidak ada email) | `/dashboard/reimbursements?id={id}` |
| `REIMBURSEMENT_APPROVED` | HR Lead/Admin approve | Karyawan pemohon | `contact_email` reimbursement, fallback email karyawan | `/dashboard/employee/reimbursement` (karyawan) atau `/dashboard/management/reimbursement` (management) |
| `REIMBURSEMENT_REJECTED` | Reimbursement ditolak | Karyawan pemohon | idem | idem |
| `REIMBURSEMENT_PAID` | Ditandai sudah dibayar (`mark_paid`) | Karyawan pemohon | idem | idem |
| `CONTRACT` | Cron: kontrak `ACTIVE` dengan sisa hari = salah satu `contract_offsets` | Karyawan + manager | Karyawan + manager + daftar email HR (HR **email saja**) | `/dashboard/karyawan` |
| `BIRTHDAY_HR` | Cron: karyawan `ACTIVE` ulang tahun H-1/H-0 | — | Daftar email HR | — |
| `BIRTHDAY_EMPLOYEE` | Cron: hari ulang tahun karyawan | Karyawan (ucapan) | Karyawan | — |

Catatan:

- Toggle `enabled=False` pada event config **mematikan email** event tersebut.
- Alur reimbursement dua lapis: `PENDING` → review (HR_STAFF/ADMIN) → `WAITING_HR_LEAD` → approve (HR_LEAD/ADMIN) → `APPROVED` → `PAID`. Event `REVIEWED` hanya untuk memberi tahu approver lapis kedua lewat bell.
- Hanya user **aktif** (`is_active=True`) yang menerima notifikasi role-based (`hr_notify_users`).

### Titik pemanggilan (hooks)

| Modul | Lokasi | Fungsi |
| --- | --- | --- |
| Leave | `apps/leaves/views.py` `perform_create` | `notify_leave_submitted(request_obj)` |
| Leave | `apps/leaves/views.py` action `approve` | `notify_leave_status(leave, 'APPROVED')` |
| Leave | `apps/leaves/views.py` action `reject` | `notify_leave_status(leave, 'REJECTED')` |
| Reimbursement | `apps/reimbursement/views.py` `submit` | `_notify('notify_reimbursement_submitted', obj)` |
| Reimbursement | `review` | `_notify('notify_reimbursement_reviewed', obj)` |
| Reimbursement | `approve` | `_notify('notify_reimbursement_approved', obj)` |
| Reimbursement | `reject` | `_notify('notify_reimbursement_rejected', obj)` |
| Reimbursement | `mark_paid` | `_notify('notify_reimbursement_paid', obj)` |

`_notify` di reimbursement adalah wrapper yang meng-import fungsi dari `apps.notifications.services` secara lazy. Penanganan error (best-effort, tidak pernah raise) dilakukan di dalam fungsi `notify_*` itu sendiri, sehingga kegagalan notifikasi tidak pernah membatalkan aksi.

---

## 5. Penerima (Recipient Rules)

Konstanta role di `services.py`:

| Konstanta | Role | Dipakai untuk |
| --- | --- | --- |
| `LEAVE_NOTIFY_ROLES` | `ADMIN`, `HR_STAFF`, `HR_LEAD` | Bell pengajuan leave |
| `REIMBURSEMENT_REVIEW_ROLES` | `ADMIN`, `HR_STAFF` | Bell reimbursement baru (reviewer lapis 1) |
| `REIMBURSEMENT_FINAL_ROLES` | `ADMIN`, `HR_LEAD` | Bell reimbursement sudah di-review (approver lapis 2) |

`hr_notify_users(roles, include_superusers=True)` mengembalikan user aktif dengan role tersebut, ditambah superuser.

Aturan penting:

- **Pemohon tidak menerima notifikasi pengajuannya sendiri** (mis. HR yang mengajukan cuti tidak dapat bell `LEAVE_SUBMITTED` untuk dirinya).
- Manager = field *Reporting To* pada data karyawan. Bila kosong, hanya HR/Admin yang diberi tahu.
- Email karyawan diambil dari data karyawan/user. Untuk reimbursement dipakai `contact_email` pada pengajuan bila diisi.
- Penerima tanpa email → baris log `SKIPPED` (atau tidak dibuat sama sekali), tanpa error.

---

## 6. Idempotensi & Delivery Log

Setiap unit pengiriman memakai `key` unik:

```
In-app : {event_key}:inapp:{user_id}
Email  : {event_key}:email:{email}
```

Contoh `event_key`:

| Event | `event_key` |
| --- | --- |
| Leave submitted | `leave-submitted:{leave_id}` (manager) dan `leave-submitted:{leave_id}:hr` (daftar email HR) |
| Leave approved/rejected | `leave-status:{leave_id}:{APPROVED\|REJECTED}` |
| Reimbursement | `reimbursement-submitted:{id}`, `reimbursement-reviewed:{id}`, `reimbursement-approved:{id}`, `reimbursement-rejected:{id}`, `reimbursement-paid:{id}` |
| Kontrak | `contract:{contract_id}:{offset}:{role}` (role = employee/manager/hr) |
| Birthday | `birthday:{employee_id}:{year}:{offset}:hr` / `birthday:{employee_id}:{year}:{offset}:employee` |

Perilaku:

- Jika key sudah ada dengan status `SENT` atau `SKIPPED` → **tidak dikirim lagi**.
- Jika key ada dengan status `FAILED` → **di-retry** pada pemicu/run berikutnya (mis. cron besok).
- Karena key memuat tahun (birthday) dan offset (kontrak), setiap tahun/offset dikirim sekali.
- Kontrak yang diperpanjang dengan kontrak baru punya `contract_id` baru, sehingga reminder berjalan lagi untuk kontrak baru.

Delivery log bisa dilihat di **Settings → Delivery Logs** (`/dashboard/settings/delivery-logs`) dan via API `/api/notifications/delivery-logs/`.

---

## 7. Pengiriman Email (Async vs Sync)

| Mode | Fungsi | Dipakai oleh | Perilaku |
| --- | --- | --- | --- |
| **Async** | `_queue_email` | Hook request (leave, reimbursement) | Dijadwalkan di `transaction.on_commit`, lalu dijalankan di `ThreadPoolExecutor` (2 worker). Response API tidak menunggu SMTP |
| **Sync** | `_send_email` | Cron (`run_all`) | Kirim langsung; hasil ditulis ke delivery log |

Aturan aktivasi async:

- Aktif hanya jika `EMAIL_BACKEND` berakhiran `smtp.EmailBackend` (produksi).
- Bisa dipaksa via setting `NOTIFICATION_EMAIL_ASYNC = True/False`.
- Di test/dev (console/locmem backend) email dikirim sinkron sehingga mudah diuji.

`EMAIL_TIMEOUT` default **15 detik** agar koneksi SMTP yang macet tidak menggantung worker.

Hasil pengiriman async tetap diperbarui ke `NotificationDeliveryLog` (SENT/FAILED + `detail` error).

---

## 8. Template Email & Placeholder

### 8.1 Rendering

`emails.render_email_parts(event, context, subject=None, body=None)` → `(subject, text, html, is_html)`:

1. Pakai `subject`/`body` dari `NotificationEventConfig`; jika kosong pakai `DEFAULT_TEMPLATES[event]` (bahasa Indonesia).
2. Placeholder `{nama}` diganti nilai dari context. **Placeholder yang tidak dikenal/kosong dirender kosong** (tidak error).
3. Jika body adalah **rich HTML** (`is_rich_html`): nilai placeholder di-HTML-escape, body disanitasi, lalu dikirim sebagai email multipart (HTML + fallback plain text via `html_to_text`).
4. Jika plain text: dikirim sebagai text biasa.

Format tanggal: `fmt_date` → `%d %b %Y` (contoh `08 Oct 2026`).

### 8.2 Placeholder yang tersedia

| Placeholder | Isi | Event relevan |
| --- | --- | --- |
| `{employee_name}` | Nama karyawan | Semua |
| `{employee_email}` | Email karyawan | Semua |
| `{manager_name}` | Nama manager (Reporting To) | Leave, Contract |
| `{manager_email}` | Email manager | Leave, Contract |
| `{contract_end_date}` | Tanggal akhir kontrak | Contract |
| `{days_remaining}` | Sisa hari kontrak | Contract |
| `{leave_type}` | Jenis izin/cuti | Leave |
| `{leave_start}` / `{leave_end}` | Tanggal mulai / selesai | Leave |
| `{leave_dates}` | Rentang tanggal | Leave |
| `{leave_days}` | Jumlah hari | Leave |
| `{leave_status}` | Status pengajuan | Leave |
| `{approver_name}` | Nama approver | Leave approved/rejected |
| `{rejection_reason}` | Alasan penolakan | Leave/Reimbursement rejected |
| `{reimbursement_category}` | Kategori reimbursement | Reimbursement |
| `{reimbursement_amount}` | Nominal diajukan | Reimbursement |
| `{reimbursement_date}` | Tanggal transaksi | Reimbursement |
| `{reimbursement_description}` | Deskripsi | Reimbursement |
| `{reimbursement_approved_amount}` | Nominal disetujui | Reimbursement approved/paid |
| `{reimbursement_bank}` | Info rekening tujuan | Reimbursement paid |
| `{payment_reference}` | Referensi pembayaran | Reimbursement paid |
| `{birthday_today}` | Penanda ulang tahun hari ini (H-0) vs besok (H-1) | `BIRTHDAY_HR` |

### 8.3 Preview

`POST /api/notifications/notification-events/preview/` dengan `{event, subject, body}` merender template memakai `PREVIEW_CONTEXT` (data contoh). Ini dipakai tombol **Preview** di editor template.

---

## 9. Sanitasi HTML

Body template rich HTML disanitasi **saat disimpan** (serializer) **dan saat dirender**, memakai whitelist di `apps/notifications/sanitize.py` (parser berbasis `html.parser`, tanpa dependensi eksternal).

| Aturan | Nilai |
| --- | --- |
| Tag yang diizinkan | `p`, `br`, `div`, `span`, `font`, `strong`, `b`, `em`, `i`, `u`, `s`, `strike`, `del`, `ul`, `ol`, `li`, `blockquote`, `a`, … (lihat `ALLOWED_TAGS`) |
| Atribut | Per tag, mis. `a`: `href`, `title`, `target`, `rel`; `p`/`div`: `style`, `dir`; `span`: `style` |
| Properti CSS `style` | `color`, `background-color`, `font-family`, `font-size`, `text-align`, `font-weight`, `font-style`, `text-decoration` |
| Dibuang beserta isinya | `script`, `style`, `iframe`, `object`, `embed`, `noscript`, `title`, `head`, `svg`, `math` |
| Atribut event | Semua `on*` dibuang |
| Tag lain | Di-*unwrap* (tag dibuang, teks tetap) |

Nilai placeholder selalu di-escape, jadi data user (nama, deskripsi, alasan) tidak bisa menyuntikkan HTML.

---

## 10. Notifikasi Terjadwal (Cron)

### 10.1 Command

```bash
# Dari container backend
python manage.py send_employee_notifications            # kirim
python manage.py send_employee_notifications --dry-run  # hanya tampilkan yang akan dikirim
```

Command memanggil `services.run_all()` yang menjalankan:

**End of Contract**

- Kontrak dengan status `ACTIVE` dan `end_date` terisi.
- `days_remaining = end_date - hari ini`; dikirim jika sama dengan salah satu `contract_offsets` (default `30,14,7,3,1,0`).
- Penerima: karyawan dan manager (bell + email), daftar email HR (email saja).
- Maksimal satu reminder per kontrak per run.

**Birthday**

- Karyawan `ACTIVE` dengan `birth_date` terisi.
- Trigger H-1/H-0 diatur **terpisah** untuk HR (`birthday_hr_h1/h0_enabled`) dan karyawan (`birthday_employee_h1/h0_enabled`). Hari itu dianggap due bila minimal satu audiens aktif; tiap audiens hanya dikirimi bila toggle-nya aktif.
- `BIRTHDAY_HR`: email ke daftar email HR.
- `BIRTHDAY_EMPLOYEE`: email + bell ucapan ke karyawan pada hari-H.

### 10.2 Jadwal yang disarankan

Jalankan **sekali sehari** (pagi hari WIB), contoh crontab di host VPS:

```cron
# Notifikasi kontrak + birthday
0 7 * * * cd /path/to/hris && docker compose exec -T backend python manage.py send_employee_notifications >> /var/log/hris-notifications.log 2>&1

# Reminder task freelance
5 7 * * * cd /path/to/hris && docker compose exec -T backend python manage.py send_task_reminders >> /var/log/hris-task-reminders.log 2>&1
```

Karena idempoten, menjalankan ulang di hari yang sama aman (tidak ada email ganda). Jika cron terlewat satu hari, reminder kontrak dengan offset pada hari itu **tidak** dikirim mundur (offset harus sama persis), sedangkan item `FAILED` akan di-retry.

---

## 11. Reminder Task Freelance (Engine Terpisah)

Engine di `apps/freelance/services.py`, **email saja**, tidak memakai `NotificationDeliveryLog`/template terpusat.

### 11.1 Konfigurasi — `TaskEscalationPolicy` (singleton)

| Field | Default | Keterangan |
| --- | --- | --- |
| `enabled` | `True` | Master switch |
| `reminder_offsets` | `3,1,0` | Hari sebelum deadline |
| `remind_freelancer` | `True` | Kirim ke `personal_email` freelancer |
| `remind_pic` | `True` | Kirim ke `company_email` pada record freelancer (PIC berupa teks bebas) |
| `escalation_cc_emails` | kosong | CC untuk reminder, **wajib** menerima eskalasi |
| `escalate_after_days` | `1` | Eskalasi pertama N hari setelah deadline, berulang tiap N hari |
| `max_escalations` | `3` | Batas jumlah eskalasi |

UI: **Pengaturan Reminder** di `/dashboard/task`. API: `/api/freelance/task-scheduler/` (termasuk aksi kirim sekarang `send-now/`).

### 11.2 Aturan

- Hanya task dengan status terbuka: `BELUM_MULAI`, `SEDANG_DIKERJAKAN`, `TERKENDALA`.
- **Reminder**: per task per run maksimal satu email, yaitu offset terdekat yang belum terkirim (task yang dibuat terlambat hanya mendapat satu reminder catch-up, bukan seluruh tangga).
- **Eskalasi**: ke-n dikirim jika `hari ini >= deadline + n × escalate_after_days`, sampai `max_escalations`. Subject `[ESKALASI] Task freelance terlambat: …`.
- Dedup via `TaskReminderLog` (task, kind, offset_days).
- Satu alamat gagal tidak menghentikan run; hasil `{sent, skipped, failed}` dicatat ke audit log.

```bash
python manage.py send_task_reminders [--dry-run]
```

---

## 12. Notifikasi Legacy per Modul

Sebelum engine terpusat, modul leave dan reimbursement punya notifikasi in-app sendiri. **Masih ditulis berdampingan** dengan engine terpusat (tanpa email ganda — email hanya dari engine terpusat):

| Model | Ditulis oleh | Endpoint |
| --- | --- | --- |
| `LeaveNotification` (`apps/leaves/models.py`) | `apps.leaves.services.notify` | `GET /api/leaves/requests/notifications/` |
| `ReimbursementNotification` (`apps/reimbursement/models.py`) | `apps.reimbursement.services.notify` | `GET /api/reimbursements/notifications/` |

Bell di header **hanya** membaca model `Notification` terpusat. Untuk fitur baru, gunakan engine terpusat; model legacy dipertahankan untuk kompatibilitas dan bisa dihapus di kemudian hari setelah tidak ada konsumen.

---

## 13. API Reference

Semua endpoint di bawah `/api/notifications/`, autentikasi session cookie + `X-CSRFToken` untuk metode non-GET.

### 13.1 Notifikasi user (`notifications/`) — semua user login, hanya milik sendiri

| Method | Path | Keterangan |
| --- | --- | --- |
| GET | `/api/notifications/notifications/` | 50 terbaru + jumlah `unread` → `{results: [...], unread: n}` |
| GET | `/api/notifications/notifications/unread_count/` | `{unread: n}` |
| POST | `/api/notifications/notifications/{id}/mark_read/` | Tandai satu dibaca |
| POST | `/api/notifications/notifications/mark_all_read/` | Tandai semua dibaca → `{marked: n}` |

### 13.2 Pengaturan (`notification-settings/`) — `IsHRAdmin`

`IsHRAdmin` = role `ADMIN`, `HR_STAFF`, `HR_LEAD`, atau superuser.

| Method | Path | Keterangan |
| --- | --- | --- |
| GET | `/api/notifications/notification-settings/` | Singleton setting |
| PATCH | `/api/notifications/notification-settings/1/` | Update (singleton, selalu pk=1); dicatat ke audit log |
| GET | `/api/notifications/notification-settings/hr_candidates/` | User `HR_STAFF`/`HR_LEAD` untuk dipilih sebagai `additional_hr_users` |

Validasi:

- `default_hr_emails`: tiap entri wajib mengandung `@`, di-dedupe.
- `contract_offsets`: hanya angka, di-dedupe, diurutkan menurun.
- `additional_hr_users`: hanya user ber-role `HR_STAFF`/`HR_LEAD`.

### 13.3 Event config (`notification-events/`) — `IsHRAdmin`

| Method | Path | Keterangan |
| --- | --- | --- |
| GET | `/api/notifications/notification-events/` | 11 event (baris otomatis dibuat bila belum ada) |
| PATCH | `/api/notifications/notification-events/{id}/` | Ubah `enabled`, `subject`, `body` (body HTML disanitasi) |
| POST | `/api/notifications/notification-events/preview/` | Body `{event, subject, body}` → hasil render dengan data contoh |

### 13.4 Delivery log (`delivery-logs/`) — `IsHRAdmin`, read-only

| Method | Path | Keterangan |
| --- | --- | --- |
| GET | `/api/notifications/delivery-logs/` | List terpaginasi |
| GET | `/api/notifications/delivery-logs/summary/` | `{total, sent, failed, skipped}` dengan filter yang sama |

Query params: `channel` (`EMAIL`/`IN_APP`), `status` (`SENT`/`FAILED`/`SKIPPED`), `event`, `search` (recipient_email, subject, key), `date_from`, `date_to` (YYYY-MM-DD).

---

## 14. Frontend

| Bagian | File | Keterangan |
| --- | --- | --- |
| Client API & tipe | `frontend/src/lib/notifications.ts` | Fungsi `listNotifications`, `markNotificationRead`, `markAllNotificationsRead`, `getNotificationSettings`, `updateNotificationSettings`, `listHrCandidates`, `listEventConfigs`, `updateEventConfig`, `previewEventConfig`, `listDeliveryLogs`, `getDeliverySummary`; label `NOTIFICATION_KIND_LABELS` |
| Bell | `frontend/src/components/notification-bell.tsx` | Badge merah jumlah unread (maks. tampil `9+`), 50 item terbaru, polling **60 detik**, klik = tandai dibaca + `router.push(link)`, tombol "Tandai semua dibaca", waktu relatif ("5 menit lalu") |
| Pengaturan | `/dashboard/settings/notification` → `features/settings/notification-settings.tsx` | Email HR default, HR tambahan, offset kontrak, toggle birthday, kartu event per grup (Izin/Cuti, Reimbursement, Kontrak, Birthday) dengan editor subject/body, chip placeholder, dan preview |
| Delivery log | `/dashboard/settings/delivery-logs` → `features/settings/delivery-log-list.tsx` | Tabel log + filter channel/status/event/tanggal + ringkasan |
| Navigasi | `frontend/src/config/nav-config.ts` | Menu Settings → Notification (difilter role di `use-nav.ts`, pemeriksaan sebenarnya di server) |

> Catatan: tipe `NotificationKind` di `lib/notifications.ts` baru memuat `LEAVE_*`, `REIMBURSEMENT_SUBMITTED`, `CONTRACT`, `BIRTHDAY`. Kind stage reimbursement (`REIMBURSEMENT_REVIEWED/APPROVED/REJECTED/PAID`) tetap tampil di bell, tetapi sebaiknya ditambahkan ke tipe & label agar konsisten.

---

## 15. Konfigurasi SMTP & Environment

Setting di `backend/config/settings.py`, dibaca dari environment:

| Env var | Default (settings.py) | Default produksi (docker-compose) | Keterangan |
| --- | --- | --- | --- |
| `EMAIL_BACKEND` | `django.core.mail.backends.console.EmailBackend` | `django.core.mail.backends.smtp.EmailBackend` | Console = email hanya dicetak ke log |
| `EMAIL_HOST` | — | host SMTP | |
| `EMAIL_PORT` | `587` | `465` | |
| `EMAIL_HOST_USER` | — | akun SMTP | |
| `EMAIL_HOST_PASSWORD` | — | password/app password | Simpan di `.env`, jangan di-commit |
| `EMAIL_USE_TLS` | `true` | `false` | STARTTLS (port 587) |
| `EMAIL_USE_SSL` | `false` | `true` | SSL langsung (port 465) |
| `DEFAULT_FROM_EMAIL` | `HRIS Feraco <hris.noreply@feraco.co.id>` | | Pengirim |
| `EMAIL_TIMEOUT` | `15` | | Detik |
| `NOTIFICATION_EMAIL_ASYNC` | otomatis (lihat §7) | | Opsional, override mode async |

`EMAIL_USE_TLS` dan `EMAIL_USE_SSL` tidak boleh sama-sama `true`.

Uji koneksi SMTP dari container:

```bash
docker compose exec backend python manage.py shell -c "from django.core.mail import send_mail; print(send_mail('Test HRIS', 'Halo', None, ['alamat@contoh.com']))"
```

---

## 16. Panduan HR/Admin

1. Buka **Settings → Notification**.
2. Isi **Email HR default** (pisahkan dengan koma) dan/atau pilih **HR tambahan** dari daftar user HR.
3. Atur **offset kontrak** (contoh `30,14,7,3,1,0` = H-30, H-14, H-7, H-3, H-1, hari-H).
4. Pada kartu **Birthday — Email ke HR** dan **Birthday — Email Ucapan ke Employee**, centang **H-1** / **H-0** masing-masing (trigger HR dan karyawan terpisah).
5. Pada tiap kartu event: aktif/nonaktifkan email, ubah subject/body, klik chip placeholder untuk menyisipkan data, lalu **Preview** sebelum menyimpan. Kosongkan subject/body untuk kembali ke template default.
6. Pantau pengiriman di **Settings → Delivery Logs**; filter `FAILED` untuk melihat email yang gagal beserta alasannya.

---

## 17. Troubleshooting

| Gejala | Kemungkinan penyebab | Solusi |
| --- | --- | --- |
| Email tidak pernah sampai, log tidak ada error | `EMAIL_BACKEND` masih console | Set SMTP backend di `.env` produksi, restart container |
| Delivery log `FAILED` dengan error auth/SSL | Kredensial salah atau kombinasi port/TLS/SSL salah | 465 → SSL=true, TLS=false; 587 → TLS=true, SSL=false |
| Delivery log `FAILED` timeout | SMTP lambat/terblokir firewall VPS | Cek koneksi keluar port SMTP; item FAILED di-retry otomatis pada pemicu/run berikutnya |
| Delivery log `SKIPPED` | Event `enabled=False`, penerima tanpa email, atau daftar email HR kosong | Lengkapi email / aktifkan event |
| Reminder kontrak tidak terkirim | Kontrak bukan `ACTIVE`, `end_date` kosong, sisa hari tidak sama persis dengan offset, atau cron tidak jalan | Cek data kontrak & crontab; jalankan `send_employee_notifications --dry-run` |
| Birthday tidak terkirim | Karyawan tidak `ACTIVE`, `birth_date` kosong, toggle mati | Lengkapi data / nyalakan toggle |
| Manager tidak dapat notifikasi cuti | *Reporting To* kosong atau user manager nonaktif | Lengkapi data karyawan |
| Bell tidak update | Polling 60 detik | Tunggu atau refresh halaman |
| Submit lambat | Mode async tidak aktif (backend bukan SMTP) | Pastikan `EMAIL_BACKEND` SMTP atau set `NOTIFICATION_EMAIL_ASYNC=True` |
| Email dobel | Seharusnya tidak terjadi (key unik) | Cek `key` di delivery log; laporkan sebagai bug |

Error notifikasi juga tercatat di **Audit Log** (`/dashboard/settings/audit-log`).

---

## 18. Testing

```bash
cd backend
python manage.py test apps.notifications          # engine terpusat
python manage.py test apps.leaves apps.reimbursement  # regresi hook
python manage.py test apps.freelance              # reminder task freelance
python manage.py send_employee_notifications --dry-run
python manage.py send_task_reminders --dry-run
```

Di test, email memakai `locmem` backend (`django.core.mail.outbox`) dan dikirim sinkron.

---

## 19. Menambah Event Baru (Checklist Developer)

1. Tambah kind di `Notification.KIND_CHOICES` (`models.py`) → `makemigrations`.
2. Tambah key ke `EVENT_KEYS` dan contoh data ke `PREVIEW_CONTEXT` (`views.py`).
3. Tambah default subject/body di `DEFAULT_TEMPLATES` dan placeholder baru di `AVAILABLE_PLACEHOLDERS` (`emails.py`).
4. Buat fungsi `notify_<event>()` di `services.py` dengan `event_key` yang unik dan stabil; gunakan helper in-app/email yang ada agar idempotensi & delivery log otomatis.
5. Panggil dari view secara **best-effort** (bungkus try/except, lazy import), setelah perubahan status tersimpan.
6. Frontend: tambah kind ke `NotificationKind` + `NOTIFICATION_KIND_LABELS` (`lib/notifications.ts`), grup event di `notification-settings.tsx`, dan opsi di `EVENT_OPTIONS` (`delivery-log-list.tsx`).
7. Tambah test: penerima benar, pemohon tidak menerima sendiri, idempotensi (dua kali panggil = satu kirim), event `enabled=False` = tidak ada email.
