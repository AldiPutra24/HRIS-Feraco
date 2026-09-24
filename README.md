# HRIS Feraco

Internal Human Resource Information System.

- **Frontend** - Next.js 16 (App Router), TypeScript, Tailwind CSS v4, shadcn/ui on Base UI. See `frontend/`.
- **Backend** - Django + Django REST Framework, PostgreSQL, session/cookie auth, RBAC, audit log. See `backend/`.

## User Form — Binding Role General Manager
- Dropdown Karyawan untuk role GENERAL_MANAGER hanya menampilkan employee Departemen "General Management" + Position "General Manager" + ACTIVE; auto-select bila tepat 1 match, empty state jelas bila tidak ada; reset saat role diganti (behavior existing EMPLOYEE/MANAGEMENT/HR tidak berubah).
- Backend `UserAdminSerializer.validate`: GM wajib terhubung employee GM (General Management + Position "General Manager" + ACTIVE) — employee lain ditolak 400, GM tanpa employee juga ditolak.
- Tests: `GeneralManagerUserBindingTests` (4) — accounts 18 OK; tsc + build bersih.

## Bugfix — Upload CV 500 (recruitment-cvs)
- Root cause: storage URL dibangun dari path tanpa percent-encoding. Filename dengan `%`, `#`, `&`, `?` (mis. "CV 100%.pdf", "CV & Portfolio#1.pdf") merusak URL Supabase Storage → Supabase 400 → `RuntimeError` tak tertangani → HTTP 500. File dengan nama sederhana lolos — cocok dengan gejala "sebagian berhasil".
- Fix minimal: `_quoted_path()` di `personnel/storage.py` (quote dengan safe='/') untuk upload/delete/sign; validasi CV (PDF/DOC/DOCX, max 10MB, cek sebelum 503 storage); storage error kini 502 dengan pesan jelas (bukan 500 diam); cleanup object orphan bila DB gagal setelah storage sukses.
- Tests: `CvUploadValidationTests` (4) — recruitment 50 OK, freelance 49 OK.

## Freelance — Akses General Manager (READ-ONLY)
- `IsFreelanceManager` (`apps/freelance/permissions.py`): GENERAL_MANAGER hanya boleh method GET/HEAD/OPTIONS — semua mutation (create/update/delete freelancer, skill & kategori, event, assignment, performance/rating/recommendation, blacklist via update, upload/delete dokumen) ditolak 403 di backend. GM tetap bisa list/detail/search/filter + document download, scope tetap semua freelancer (bukan Employee hierarchy).
- Frontend (`/dashboard/freelance`): `readOnly` saat role `general_manager` — Quick Add, tombol Hapus, Edit, hapus skill, form upload/dokumen, dan Tambah/Edit/Hapus riwayat event disembunyikan. Role lain tidak berubah.
- Tests: `GeneralManagerFreelanceAccessTests` (5, termasuk matrix 403 semua endpoint mutation) — freelance 55 OK; tsc + build bersih.

## Freelance — Akses General Manager
- Role GENERAL_MANAGER kini termasuk `FREELANCE_ROLES` (`apps/freelance/permissions.py`): GM dapat melihat seluruh Freelancer/Talent Pool via endpoint existing `/api/freelance/freelancers/` (tanpa endpoint baru). Scope GM = semua data freelancer — Freelancer bukan Employee sehingga `team_scope_ids()`/hierarchy reporting tidak berlaku; queryset tetap penuh, filter/search/sort existing bekerja normal.
- Scope Management/HR/Admin/Employee tidak berubah. GM tidak mendapat akses modul lain (permission di-add hanya di Freelance).
- Frontend: nav item "Freelance / Talent Pool" ditambahkan ke `managementNavGroups` sehingga muncul di sidebar GM.
- Tests: `GeneralManagerFreelanceAccessTests` (4: GM lihat semua, tidak terbatas hierarchy + search bekerja, MANAGEMENT & HR behavior unchanged) — freelance 54 OK; tsc + build bersih.

## Role GENERAL_MANAGER (General Manager)
- Role baru `GENERAL_MANAGER` (Role choices + migration `accounts/0004` + seed_roles); login masuk ke dashboard Management yang sama (`/dashboard/management/overview`), sidebar `managementNavGroups`.
- Scope backend via `team_scope_ids()`: MANAGEMENT = direct reports; GENERAL_MANAGER = hierarki reporting penuh di bawahnya (BFS transitive via `Employee.manager`). Employee list, dashboard, leave, payroll semuanya ter-scope di backend — bukan frontend-only.
- GM bisa dipilih sebagai Reporting To (langsung Aktif, bebas department); Management boleh reporting ke GM. Reporting existing tidak diubah.
- Tests: `GeneralManagerRoleTests` (7) OK; leaves 38 OK; payroll 130 OK; personnel 116 (1 error pre-existing `test_import_xlsx`). tsc + build bersih.

## Employee Contract — Urutan PKWT
- Field `pkwt_sequence` (PositiveIntegerField, nullable) pada `EmployeeContract` + migration `personnel/0016`; kontrak lama tanpa nilai tetap kompatibel.
- Form `+ Add Contract`: input numerik **Ke- / PKWT** terpisah dari No. Kontrak (Tipe | Ke- / PKWT | No. Kontrak); validasi integer ≥ 1, PKWT-only, tidak boleh ≤ urutan kontrak sebelumnya (server-side di `EmployeeViewSet.contracts` + client-side).
- Current Contract menampilkan `PKWT ke-N`; Contract History punya kolom **Ke- / PKWT**.
- Tests: `ContractPkwtSequenceTests` (6) OK; personnel suite 109 tests (1 error pre-existing `test_import_xlsx`, juga gagal sebelum perubahan). tsc + build bersih.

## Structure

```
/
+-- frontend/              # Next.js
|   `-- src/{app,components,features,lib,hooks,types}
+-- backend/               # Django
|   +-- config/            # settings, urls, wsgi/asgi
|   `-- apps/
|       +-- accounts/      # User, Role, Permission, auth endpoints
|       +-- personnel/     # Personnel/Employee/Freelancer/Department/Position
|       +-- leaves/        # LeaveType/LeaveBalance/LeaveRequest + business rules
|       `-- audit/         # AuditLog
+-- docs/
+-- docker-compose.yml
`-- .env.example
```

## Local development

### Backend

```bash
cd backend
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
$env:DB_ENGINE='sqlite'                 # or configure PostgreSQL in .env
.\.venv\Scripts\python.exe manage.py migrate
.\.venv\Scripts\python.exe manage.py seed_roles   # roles + admin@feraco.id / password
.\.venv\Scripts\python.exe manage.py runserver
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Set `NEXT_PUBLIC_API_URL=http://localhost:8000` (see `frontend/.env.example`).

### Docker Compose

```bash
docker compose up --build
```

Starts PostgreSQL, Django (migrate + seed + gunicorn on :8000), Next.js on :3000.

## Validation

- Backend: `manage.py check` + `manage.py test`
- Frontend: `npx tsc --noEmit`, `npx oxlint`, `npx next build`

## Demo login

- Email: `admin@feraco.id` / Password: `password`

## Roles

| Role | Keterangan |
| --- | --- |
| `ADMIN` | Akses penuh: kelola user, role, permission, seluruh modul, audit log. |
| `HR_STAFF` | Operasional HR harian: kelola karyawan, kontrak, cuti/izin, reimbursement. |
| `HR_LEAD` | Supervisor HR: approval cuti, review + audit log (baca), kelola departemen & posisi. |
| `EMPLOYEE` | Self-service: lihat profil, ajukan cuti/izin, lihat kontrak sendiri. |
| `MANAGEMENT` | Lihat laporan/ringkasan & approval strategis (read-heavy). |

Catatan: filtering menu di frontend (`use-nav.ts`) hanya UI; otorisasi di backend (Django permission/role).

## Last Progress

**Knowledge Management System / KMS (`apps.kms`)** — last updated 2026-09-17

- **Backend (`apps.kms`, migration `0001`)** — pusat knowledge internal (panduan HRIS, SOP, kebijakan, FAQ, pengumuman). `KnowledgeCategory` (self-FK `parent`, depth maks 2: parent harus root, no self-parent, unique per level) + `KnowledgeArticle` (title/summary/content, category+subcategory tervalidasi, status DRAFT/PUBLISHED/ARCHIVED + published_at, attachment, view_count, created_by/updated_by). API `/api/kms/`: `categories/` (+`tree/`, delete terguard — masih dipakai → nonaktif) dan `articles/` (filter category-yang-implies-subkategori/subkategori/status, search title+summary+content+nama kategori, pagination, actions `archive/restore/attachment/attachment-url/related`). RBAC backend `IsKmsAdmin`: read semua role terautentikasi, write/delete hanya ADMIN/HR_STAFF/HR_LEAD; DRAFT/ARCHIVED tersembunyi dari role read-only (listing + detail). Content disanitasi via `notifications.sanitize` (anti-XSS); attachment bucket privat `kms-documents(-dev)` + signed URL. Command `seed_kms_categories` (HRIS + Internal + subkategori, `--with-demo-article` opsional). **23 tests OK**.
- **Frontend** — `/kms` knowledge base UI: search server-side, sidebar kategori tree (Semua/Kategori/Subkategori + count), kartu knowledge (summary, badge kategori, status badge manager-only, updated date), empty/loading/error state, pagination. `/kms/[id]` detail: konten render aman, meta author/update, lampiran (signed URL), Knowledge Terkait, aksi Edit/Arsipkan/Pulihkan/Hapus (manager). Modal Tambah/Edit (kategori→subkategori berantai, konten via `EmailBodyEditor` reuse) + "Kelola Kategori" (tambah/rename/nonaktif/hapus). Sidebar: grup "Knowledge" di nav HR + item `Knowledge / KMS` di management & employee nav (semua role); icon `books` baru. `tsc` 0 error, oxlint 0 error, `next build` OK.

**Employee Inhouse Notification & Email Reminder (`apps.notifications`)** — last updated 2026-09-17

- **Backend (`apps.notifications`, migration `0001`)** — notifikasi in-app + email untuk alur karyawan inhouse: Izin/Cuti (submitted/approved/rejected, REJECTED memuat alasan), End of Contract H-30..H-0 (offsets configurable default 30,14,7,3,1,0), Birthday H-1/H-0 toggle terpisah (karyawan ACTIVE saja). Models: `Notification` (in-app), `NotificationEventConfig` (6 event, template subject/body editable), `NotificationSetting` (singleton — default HR emails + additional HR users M2M + toggles + offsets), `NotificationDeliveryLog` (key unique = idempotency, no duplicate email; FAILED boleh retry run berikutnya). Hooks best-effort di leave submit/approve/reject — kegagalan notif tidak mengganggu alur leave; `LeaveNotification` lama tetap jalan, tidak ada duplikasi email. API `/api/notifications/` (list own + `unread_count/` + mark read/all, `notification-settings/` singleton HR/Admin via `IsHRAdmin`, `notification-events/` GET/PATCH template). Command `send_employee_notifications [--dry-run]` untuk cron harian (berdampingan dengan `send_task_reminders`). **37 tests OK** (regresi leaves 38 + freelance 49 + accounts 14 = 138 OK).
- **Frontend** — `src/lib/notifications.ts` (types + API client: list, unread count, mark read/all, settings PATCH, template event), `src/components/notification-bell.tsx` (bell di header: badge unread, daftar 50 terakhir, klik item = mark-read + navigate ke `link`, "Tandai semua dibaca", polling 60 detik), halaman `/dashboard/settings/notification` (`features/settings/notification-settings.tsx`): kelola default HR emails + HR tambahan, offsets kontrak, toggle Birthday H-1/H-0 terpisah, EventCard per event (toggle Aktif + editor subject/body + placeholder chips klik-untuk-copy), save via PATCH tanpa reload. Nav Settings baru "Notification & Email". `tsc` 0 error; `next build` OK.

**Event Management & Overview (`/dashboard/event`)** — last updated 2026-09-16

- **Frontend only (0 perubahan backend)** — backend event (`Event`, `EventAssignment`, `FreelancerPerformance`, `EventViewSet.task-progress`) sudah lengkap sejak Fitur 1B/1C, tidak ada model/API duplikat. Placeholder `/dashboard/event` diganti halaman penuh: list event (search nama/klien/lokasi, client-side), baris expandable per event dengan progress bar + persen (via `getEventTaskProgress`) + badge per-status task (SELESAI/SEDANG_DIKERJAKAN/BELUM_MULAI/TERKENDALA), tabel penugasan freelancer (role/PIC/tanggal/rating/rekomendasi) + Tambah/Edit/Hapus penugasan + rating performa (menutup deferred Fitur 1B "UI add assignment / rate performance"), link ke `/dashboard/task`, modal Tambah/Edit event + delete confirm (warning cascade assignment & task). `lib/freelance.ts`: type `EventInput` + `updateEvent`/`deleteEvent`/`listAssignments`.
- **Perbaikan UX modal** — backdrop modal `<button>` → `<div>` di 7 modal (event: EventModal/AssignmentModal/ConfirmDialog; task: TaskModal; freelance: EventHistoryModal/EditFreelancerModal/QuickAddFreelancerModal/SkillCategoryModal): mengetik spasi di input tidak lagi menutup modal, klik backdrop tidak menutup modal (hanya tombol Batal/Simpan/Tutup). Validasi: `tsc` 0 error, `next build` OK, backend tidak disentuh (49 tests freelance tetap).

**Production Environment & Core Modules Summary** — last updated 2026-08-28
**Freelance & Talent Pool Module (Fitur 1B)** — last updated 2026-09-15

- **Backend (`apps.freelance`)** — module terpisah dari Employee/Inhouse. Models: `SkillCategory`, `Skill`, `FreelancerSkill` (through), `FreelancerDocument` (upload ke bucket Supabase `recruitment-cvs` — reuse, tidak buat bucket baru), `Event`, `EventAssignment`, `FreelancerPerformance` (rating 1–5 + recommendation RECOMMENDED/RECOMMENDED_NOTES/NOT_RECOMMENDED). `Freelancer` diperluas di `apps.personnel` (whatsapp, domicile, rate/rate_type/rate_min/rate_max, is_blacklisted + reason). RBAC `IsFreelanceManager` = ADMIN/HR_STAFF/HR_LEAD/MANAGEMENT/EMPLOYEE (freelancer TIDAK punya login). ViewSets: freelancers (list+filter skill/rating/recommendation/blacklist, detail nested, skills add/remove, documents upload/url/download/delete), skills, skill-categories, events, assignments (+ performance create/update). 9 tests pass.
- **Frontend** — `src/lib/freelance.ts` (types + API client: csrf, paginated unwrap, semua endpoint). `src/app/dashboard/freelance/page.tsx`: list table (search nama/HP/email/domisili, filter status/skill/rating/recommendation/blacklist, star rating, badges), Quick Add modal, detail drawer (Sheet) dengan skill add/remove, CV/portfolio upload (file + URL), riwayat event + performa, dan Skill & Kategori management modal. `tsc` clean; oxlint hanya `set-state-in-effect` (pattern konvensi existing, sama dgn payroll/management).
- **Deferred (sesuai scope)** — magic link, task & progress, reminder, WhatsApp integration, eskalasi otomatis, freelancer login.

**Payroll Module — Tax Config UI (Phase 3d)** — last updated 2026-09-10

- **Konfigurasi Pajak tab (`frontend/src/features/payroll/payroll-page.tsx`)** — pure-frontend UI over the existing Tahap 3a/3b APIs (no new endpoints): edit `dtp_threshold` + `is_active` toggle, annual layer limits (empty = statutory 60jt/250jt/500jt/5M), TER bracket bulk editor (category A/B/C, bruto bounds, rate), annual Pasal 17 override editor (layers 1–5, empty = reset to statutory 5/15/25/30/35%), and per-employee tax profiles (PTKP select + TER category display + NORMAL/GROSS_UP scheme, with missing-profile filter). Backend: `TaxConfigSerializer` now exposes `ter_brackets` (read-only nested) so the TER editor loads existing rows. `tsc` clean, `next build` passes, 78 payroll tests pass; docs in `docs/payroll.md`.

**Payroll Module — Payslip PDF + Recap Export (Phase 3c)** — last updated 2026-09-10

- **Slip gaji PDF (`apps.payroll`)** — `GET /api/payroll/payrolls/{id}/payslip/` (HR only) renders an A4 reportlab PDF per PRD Section 6: company header from the new `CompanyConfig` singleton (name/address/department_name), "SLIP GAJI [BULAN] [TAHUN]" + slip number, employee data, PENGHASILAN vs POTONGAN columns from snapshot items, totals, THP, and terbilang of `net_salary` (stdlib Indonesian number-to-words in `terbilang.py`). Guard: period must be PAID/LOCKED (slip exists only after payment confirmed). Slip numbers `001/HRGA/MM/YYYY` are sequential per period (reset every month, PRD decision #4), unique via partial DB constraint, assigned lazily + idempotently at first download.
- **Management Overview — Pengumuman section** — reuses the existing announcement API (`listAnnouncements`, backend already scopes non-HR reads to currently visible announcements; MANAGEMENT is a non-HR role so authorization is inherited) and the Employee Dashboard detail flow (Sheet slide-over with title, publish date, author, body). Card shows up to 3 ACTIVE announcements (title, 2-line body clamp, date, optional end date), empty state "Belum ada pengumuman.", placed between the team/leave summary grid and Aktivitas Terbaru. No backend changes, no new components.
- **Management Overview redesign** — `/api/dashboard/management/` now also returns `team_members` (direct reports with position/department/status) and `pending_leave_items` (max 5 oldest-start PENDING leaves, same manager scope). The page rebuilds to a focused flow: 4 KPI cards (Total Tim, Karyawan Aktif, Izin/Cuti Pending, Reimbursement Pending — inactive KPI removed, amber accent on pending counts), "Perlu Perhatian" list with per-item CTA to leave approvals (no subordinate reimbursements), Tim Saya (initial avatar, position · dept, Aktif/Nonaktif badge) + Ringkasan Izin & Cuti (2×2 stat grid + total row), Aktivitas Terbaru from the existing own-notifications API (kind icon, message, relative time, deep link), and scoped quick actions (Lihat Tim / Persetujuan Cuti / Reimbursement Saya / Slip Gaji). Compact card heights, consistent 5-gap rhythm, dark-mode-safe accents, skeleton loading + retry error state. No dummy data, no permission changes; old team-distribution card dropped in favor of the member list.
- **Management self-service reimbursement** — MANAGEMENT now runs the same reimbursement flow as EMPLOYEE: `GET /api/reimbursements/` scopes Management to their OWN records only (previously view-only over direct reports'), create auto-assigns requester = logged-in manager (any `employee` payload value is overridden server-side), and they can edit/submit/cancel their own drafts. Approve/reject/mark_paid remain HR/Admin-only (403 for Management, unchanged). Direct API access to another user's reimbursement (read/edit/submit/cancel) returns 404 via the scoped queryset. Frontend: Management sidebar "Reimbursement" is expandable (Pengajuan Saya → `/dashboard/management/reimbursement`, Ajukan Reimbursement → `/dashboard/management/reimbursement/new`) reusing the Employee UI components; the old "Reimbursement bawahan langsung" view redirects managers to the self-service page (HR approval view untouched). 43 reimbursement tests pass incl. 8 rewritten Management-scope tests.
- **Rekap transfer XLSX** — `GET /api/payroll/periods/{id}/recap/` (HR only) exports No / Nama Karyawan / Bank / No Rekening / Nominal Transfer (`transfer_amount`, so DTP rows carry the real figure) + TOTAL row via openpyxl — for manual internet-banking upload (PRD langkah 5). Frontend: blob-download helpers in `lib/payroll.ts`; "Rekap" button per period row and "Slip" button per payroll row, shown only when PAID/LOCKED. 78 payroll tests pass; docs in `docs/payroll.md`.
- **Employee self-service payslip (Phase 3c)** — `GET /api/payroll/payrolls/my-payslips/` returns the logged-in employee's own payroll rows for PAID/LOCKED periods only (newest first; 404 if the user has no linked employee record; 403 for unauthenticated/others). `GET /api/payroll/payrolls/{id}/payslip/` now allows EMPLOYEE to download their OWN slip (ownership checked server-side; other employees' slips stay 403) while HR/Admin access is unchanged and the PDF generator/recap endpoint are untouched. `PayrollSerializer` adds read-only `period_status` + `period_label`. Frontend: `/dashboard/employee/payslip` ("Slip Gaji") card grid — period, THP/Transfer (DTP-aware), status badge, "Download Slip" using the real Payroll ID — plus sidebar item after Kontrak; empty state when no final payroll exists. 8 new backend tests (own list, exclusion, unauthenticated, no-employee-record, own PDF download, other-employee 403, draft-period 400, HR unchanged); 130 payroll tests pass; `tsc` clean, `next build` OK.
- **Deferred** — editable per-period payslip footer notes, GROSS_UP iterative scheme, GM aggregate/detail access.

**Payroll Module — December Annual True-up (Phase 3b)** — last updated 2026-09-10

- **Annual PPh 21 true-up (`apps.payroll`)** — the final masa pajak (December, or the last paid month of a mid-year termination per PMK 168/2023) now recalculates PPh 21 on the full tax year: `(gross setahun − biaya jabatan − PTKP tahunan) × Pasal 17 (5–35%)` minus the PPh already withheld Jan–Nov. Annual gross is rebuilt from persisted payroll rows (basic salary + SYSTEM taxable items); biaya jabatan = 5% capped Rp500rb/month worked (pro-rata factors count fractionally); negative true-up (TER overpayment) floors at 0 — refund belongs to the annual SPT. Pasal 17 layers default to statutory 60jt/250jt/500jt/5M @ 5/15/25/30/35% (cost index 0, no indexing), overridable per year via `TaxConfig.annual_layer_limits` or new `AnnualTaxBracket` rows (layer 1–5). Snapshots `pph_prior_months` + `pph_annual` stored on December payrolls. API: `POST /api/payroll/tax-config/{id}/annual_brackets/` (bulk replace, ADMIN/HR only). 71 payroll tests pass; docs in `docs/payroll.md`.
- **Deferred** — slip PDF/terbilang/numbering + recap export + employee self-service slips (Phase 3c), GROSS_UP iterative scheme, GM aggregate/detail access (kept MANAGEMENT = own slips only).

**Role Scope: MANAGEMENT & GENERAL_MANAGER (Karyawan/Freelance/Payroll)** — last updated 2026-09-24

- **Karyawan**: Management tetap hanya melihat direct reports (scoping `team_scope_ids()` di `EmployeeViewSet`); GM melihat seluruh karyawan — keduanya sudah di-enforce backend sejak perubahan sebelumnya, tidak diubah.
- **Freelance / Talent Pool**: MANAGEMENT dihapus dari `FREELANCE_ROLES` — semua endpoint Freelance kini menolak Management (403); menu Freelance juga dihapus dari sidebar Management. GM tetap full read-only, HR/Admin/Employee tidak berubah.
- **Payroll**: `PAYROLL_VIEW_ROLES` tidak lagi memuat MANAGEMENT — endpoint admin/konfigurasi (periods/components/tax-config/tax-profiles/review) menolak Management (403). `PayrollViewSet` memakai permission baru `PayrollSelfPermission` dengan queryset self-scoped (sendiri saja; EMPLOYEE ikut self-scoped), `my-payslips` dan download slip sendiri dibuka untuk Management via flow self-service Employee. Frontend: `/dashboard/payroll` menampilkan `EmployeePayslip` (slip milik sendiri) untuk role non-admin, dan `PayrollPage` admin penuh hanya untuk ADMIN/HR. GM payroll scope tidak berubah.
- **Test**: Management payroll 403 semua admin endpoint + my-payslips self-service; Management freelance 403; GM/HR/Employee unchanged. Suite payroll 133 OK, freelance 55 OK, personnel GM 7 OK; `tsc` clean, `next build` OK.

**Candidate Freelance — Direct Talent Pool Flow** — last updated 2026-09-23

- Candidate Freelance tidak lagi menjalani pipeline Inhouse (Screening → Interview → Offer → Offer Accepted). Detail page freelance menampilkan status sederhana "Kandidat Freelance" + tombol utama **Pindahkan ke Freelance / Talent Pool**; setelah sukses redirect ke `/dashboard/freelance` dengan toast konfirmasi. Tombol berubah jadi disabled **Sudah di Talent Pool** bila kandidat sudah ter-mapping (endpoint `POST /candidates/{id}/accept-freelance/` existing: dedup by email/phone, fill-only-empty agar data kurasi Freelancer tidak tertimpa, CV → FreelancerDocument, mapping job location → domicile dan position (free-text/FK) → Skill tag via `FreelancerSkill`, tidak pernah membuat Employee/User/Contract/Onboarding). `CandidateSerializer` expose `talent_pool_freelancer_id` untuk flag duplikat. Candidate Inhouse tetap memakai pipeline existing tanpa perubahan. 3 test baru: mapping domicile+skill, flag talent_pool_freelancer_id, pipeline inhouse unchanged. Suite recruitment 57 OK, freelance 55 OK; `tsc` clean, `next build` OK.

**Recruitment Job Form — Inhouse vs Freelance** — last updated 2026-09-23

- Add/Edit Job form di Job Management kini dinamis mengikuti `Recruitment Type` (tanpa reload): **Inhouse** tetap menampilkan Department (dropdown), Position (dropdown), dan Employment Type; **Freelance** menyembunyikan ketiganya dan mengganti Position menjadi text input bebas (placeholder `Contoh: MC, Photographer, Event Crew`). Judul, Location, Open/Close Date, Deskripsi, Requirements tetap tampil untuk kedua tipe. Backend: field baru `Job.position_text` (migration `0006`); `JobSerializer` memakai aturan kelengkapan per tipe (`REQUIRED_FIELDS_BY_TYPE`) — freelance tidak lagi membutuhkan department/position FK/employment_type untuk berstatus OPEN, inhouse tidak berubah sama sekali. Menyimpan form freelance mengosongkan department/position; switching freelance→inhouse tanpa master data turun ke DRAFT. Halaman publik job menampilkan `position_text` untuk freelance job. 4 test baru (`RecruitmentTypeTests`): create freelance tanpa master data, edit inhouse→freelance, freelance→inhouse tanpa master data → DRAFT, inhouse existing tidak berubah. Recruitment suite 54 OK; `tsc` clean, `next build` OK.

**Payroll Module — Core Calculation Engine (Phase 3a)** — last updated 2026-09-10

- **TER PPh 21 engine (`apps.payroll`)** — tax rates are data, not code: `TaxConfig` (per tax year, `is_active`, DTP threshold), `TerBracket` (TER category A/B/C × bruto bracket × rate), `EmployeeTaxProfile` (PTKP status + reserved tax scheme). `calculate_period` now pays ACTIVE employees plus recently-terminated final pay (pro-rata basic salary on join/termination months), deducts unpaid leave monetarily ((basic+fixed)/30 × days), and computes monthly TER PPh 21 (rounded down to thousands) as a SYSTEM item with PTKP/TER snapshots. DTP: printed THP stays normal; when THP ≤ Rp10 jt threshold the PPh is not really deducted (`transfer_amount = net + pph`, stored separately from `net_salary`). Hard guard: calculation refuses to run without an active tax config. `seed_tax_config` loads an inactive 2026 bracket template (illustrative rates — must be confirmed with the tax consultant per PMK 168/2023). API: `/api/payroll/tax-config/` (+ bulk `brackets/` action) and `/api/payroll/tax-profiles/` (ADMIN/HR only). 58 payroll tests pass; module docs in `docs/payroll.md`.
- **Deferred** — slip PDF/terbilang/numbering + recap export + employee self-service slips (Phase 3c), GM aggregate/detail access (kept MANAGEMENT = own slips only).

**Recruitment Onboarding — Tahap 3 (`apps.onboarding`)** — last updated 2026-09-04

- **Recruitment Inhouse vs Freelance** — `Job.recruitment_type` (INHOUSE/FREELANCE, default INHOUSE via migration `0005` so all existing jobs stay inhouse) with backend validation in `JobSerializer`. Job Management page gets an Inhouse/Freelance/Semua tab filter + a `Recruitment Type` field on the Add/Edit form; the table shows a category badge. CandidateViewSet accepts `?recruitment_type=` (filtered through the related job) so Candidate Inhouse (`/dashboard/recruitment/candidates`) and Candidate Freelance (`/dashboard/recruitment/candidates/freelance`) lists never mix — nav menus for Recruitment and Candidate are now expandable with those two submenus each. New `POST /api/recruitment/candidates/{id}/accept-freelance/` (HR roles only): freelance candidates enter the EXISTING Freelance/Talent Pool — `talent_pool.py` creates or dedups (by email, fallback phone) a `Freelancer`, fills only empty fields so curated data survives, links the CV as a `FreelancerDocument` (binary stays in the `recruitment-cvs` bucket), and marks the candidate OFFER_ACCEPTED with status history. Inhouse candidates are rejected by the action (400) and no Employee/User/Onboarding is ever created by the freelance path. The candidate detail page shows a Kategori field. 10 new backend tests (`RecruitmentTypeTests`): default typing, create both types, invalid type rejected, job/candidate filter isolation, freelance accept → talent pool, dedup against an existing freelancer, inhouse-candidate rejection, rejected-candidate rejection, unauthenticated 403. Recruitment suite 46 OK; onboarding regression suites all OK; `tsc` clean, `next build` OK.
- **Onboarding tracking** — bridges `Candidate` (`OFFER_ACCEPTED`) → Employee conversion. `Onboarding` (OneToOne→Candidate) with status `PENDING→IN_PROGRESS→DOCUMENT_REVIEW→READY→COMPLETED` (+ `CANCELLED`), backend-enforced forward-only `TRANSITIONS` map. `COMPLETED` is terminal and reachable ONLY via the `complete` action — PATCH status and `transition` to `COMPLETED` are both blocked (400). `OnboardingStatusHistory` (from/to/changed_by/note) written per transition + AuditLog. `Onboarding` now also links `employee` (OneToOne→`personnel.Employee`) + `completed_by` (FK user).
- **API** — `OnboardingViewSet` at `/api/onboarding/`: create validates candidate is `OFFER_ACCEPTED` + no duplicate; update/PATCH blocked on terminal states; `POST /{id}/transition/` validates against the map (invalid/backward/terminal → 400). `POST /{id}/complete/` (READY→200, COMPLETED→200 idempotent, else 400) creates Employee + EmployeeContract + User account (EMPLOYEE role, random password, never exposed) inside a transaction, sets onboarding COMPLETED, and logs 4 audit events. RBAC `IsOnboardingAdmin` — ADMIN/HR_STAFF/HR_LEAD full, MANAGEMENT read-only, EMPLOYEE denied. Serializer exposes candidate/job/department/position names, `next_statuses`, `created_by_name`, `status_history`, `completed_by_name`, `employee_id`/`employee_name`/`employee_status`, `account_status`.
- **Frontend** — `/dashboard/recruitment/onboarding` list (filter/search table, status badges, per-row next-status buttons, "Buat Onboarding" modal listing `OFFER_ACCEPTED` candidates) + `/[id]` detail (4 tabs: Data/Checklist/Documents/Summary; Aksi card shows transition buttons until READY, then "Complete Onboarding" button; COMPLETED shows Hasil Onboarding with employee/account info). `lib/onboarding.ts` API client incl. `completeOnboarding(id)`; nav url fixed from `/dashboard/onboarding`.
- **Validation** — 94 onboarding tests pass; frontend `tsc`, `oxlint`, `next build` clean.
- **Skipped per spec** — none; full Tahap 1+2+3 implemented.

**Payroll Module — Payroll Processing (Phase 2)** — last updated 2026-09-02

- **Payroll Periods & Processing (`apps.payroll`)** — `PayrollPeriod` (unique month/year, status DRAFT→CALCULATED→REVIEW→APPROVED→PAID→LOCKED with backend-enforced forward-only transitions + `can_transition_to()`), `Payroll` (per-employee, unique period+employee, totals basic/fixed/variable/deduction/reimbursement/gross/net), `PayrollItem` (SYSTEM/MANUAL source, snapshot fields). `services.calculate_period()` validates DRAFT, iterates all Employees, get-or-create Payroll, regenerates SYSTEM items (preserves MANUAL), `transaction.atomic`; reads effective SalaryStructure (`_effective_structure`) + APPROVED reimbursements. Manual item add/remove actions on LOCKED period → 400; non-admin → 403. Period transition actions: `calculate`/`review`/`approve`/`mark-paid`/`lock` (`url_path='mark-paid'`). RBAC `PAYROLL_ADMIN_ROLES` = ADMIN/HR_STAFF/HR_LEAD, read adds MANAGEMENT. Migration `0002`. 32 payroll tests pass (8 period + 10 calculate + 4 manual item).
- **Frontend (`payroll-page.tsx`)** — 3 tabs: Payment Types / Struktur Gaji / **Payroll Processing**. Period list (status badges, next-action transition buttons, delete with confirm), create-period form (auto start/end dates from month/year), drill-in per-period payroll table with per-employee totals + manual item add/remove (LOCKED guard). `lib/payroll.ts` +7 API fns (listPeriods/createPeriod/deletePeriod/transitionPeriod/listPayrolls/addManualItem/removeManualItem).
- **Skipped per spec** — PPh21/BPJS/lembur/pro-rata/attendance deduction deferred to Tahap 3 (Calculation Engine).

**Leave Module — Admin Hard Delete (Phase 2.1)** — last updated 2026-09-02

- **Admin hard delete (`apps.leaves`)** — admin/superadmin can permanently delete leave requests on `/dashboard/leave`. `LeaveRequestViewSet` `destroy` override + `DELETE /requests/{id}/hard-delete/` action, both restricted to `is_superuser or role == 'ADMIN'` (403 otherwise — also fixes pre-existing hole where request owner could DELETE own request). Hard-deleting an APPROVED request restores deducted quota on the target type (`deducts_from or leave_type`); notifications cascade; audit logged. 27 leaves tests pass (4 new). Frontend: `hardDeleteLeave(id)` in `lib/leaves.ts`; admin-only "Hapus" button + confirm modal in `leave-page.tsx`.

**Leave Module — HR Business Rules (Phase 2)** — last updated 2026-09-01

- **Leave Business Rules (`apps.leaves`)** — 6 new `LeaveType` fields (migration `0004`): `max_days_per_request` (per-request duration cap), `min_tenure_months` (tenure eligibility), `max_days_without_attachment` (attachment mandatory above this many days), `carry_forward_max` (unused days carried to next year, capped), `deducts_from` (deduct from another type's balance, e.g. Cuti Berobat uses Cuti Tahunan), `is_paid`. `None/0` = rule not enforced. Carry-forward + target-type deduction in `services.get_balance()`/`apply_approval_deduction()` (still idempotent via `balance_deducted`). Serializer validates tenure/duration/attachment/quota at submit. `seed_leave_types` now seeds 13 types (9 LEAVE incl. MEDICAL→ANNUAL deduct + 4 PERMISSION incl. SICK 1-day-no-note/unpaid; Cuti Tidak Berbayar = no category, note in reason). 23 leaves tests pass.
- **Turbopack icon registry fix** — 5 shadcn ui components (`checkbox/sheet/breadcrumb/dropdown-menu/sidebar`) moved to centralized `Icons.xxx` object (`Icons.check/close/chevronRight/dots/panelLeft`); `icons.tsx` has no named exports so direct named imports broke Turbopack.
- **Candidate Pipeline V1 (`apps.recruitment`)** — 9 statuses (`APPLIED/SCREENING/INTERVIEW_HR/INTERVIEW_USER/INTERVIEW_GM/OFFERING/OFFER_ACCEPTED` + terminal `REJECTED/WITHDRAWN`). Backend-enforced transition map (`Candidate.TRANSITIONS`) — no arbitrary jumps; `POST /api/recruitment/candidates/{id}/transition/` (HR-only RBAC) writes `CandidateStatusHistory` (from/to/changed_by/note) + AuditLog per change. `APPLIED` may skip to `INTERVIEW_HR`; terminal statuses have no further transitions. Candidate detail shows pipeline stepper, next-status action buttons (Reject/Withdraw), optional note, and status history timeline. Candidate list filters all statuses + job. Per-job kanban view (no new lib — plain flex columns) at `/dashboard/recruitment/jobs/{id}/applications`. Migration `0004`. 34 recruitment tests.
- **Candidate Inbox** — CV upload to Supabase Storage bucket `recruitment-cvs` (signed download URLs), `Candidate.status` field (default `APPLIED`), list filters (job/status), detail page `/dashboard/recruitment/candidates/[id]`. Migration `0003`.
- **Recruitment Module (jobs)** — Job management + public job portal. HR page `/dashboard/recruitment/jobs` (list/search/filter, Add/Edit, Open/Close/Reopen, Delete DRAFT-only, Copy Link); public portal `/jobs/{slug}` (no auth, apply form — name/email/phone + optional CV). Status is **system-managed by backend**: complete required fields → `OPEN`, incomplete → `DRAFT`; `DRAFT` editable + hidden, auto-`OPEN` when completed, public only `OPEN` (excludes expired close_date); frontend cannot force status. RBAC `RECRUITMENT_ADMIN_ROLES` = ADMIN/HR_STAFF/HR_LEAD; audit via existing `log_event`.
- **Reimbursement Module (`apps.reimbursement`)** — Employee expense claims end-to-end. Configurable `ReimbursementCategory` (some require attachment), `Reimbursement` workflow (DRAFT/PENDING/APPROVED/REJECTED/PAID/CANCELLED) with submit/approve/reject/mark_paid/cancel actions, Supabase Storage attachments (signed download URLs), in-app `ReimbursementNotification`, RBAC (`REIMBURSEMENT_ADMIN_ROLES` = ADMIN/HR_STAFF/HR_LEAD), `seed_reimbursement_categories` command. HR page `/dashboard/reimbursements`; employee self-service `/dashboard/employee/reimbursement` (+ `/new` form: create → upload → submit). 20 tests.
- **Centralized auth session expiry** — 401/403 from `/api/auth/me/` or any API call triggers session clear + redirect to `/login` with return URL preserved. Implemented centrally in `auth-client.ts`, `api-client.ts`, `AuthProvider`, and `ProtectedRoute`. No per-page logic needed. See `src/lib/session-events.ts`.
- **Employee & Contract Lifecycle** — Employee CRUD, Department & Position masters, contract management (PKWT/PKWTT, system-managed status DRAFT/ACTIVE/EXPIRED/TERMINATED/RENEWED), employment history, and employee documents stored in Supabase Storage (signed download URLs).
- **Leave Module (`apps.leaves`)** — Configurable `LeaveType`, annual `LeaveBalance` tracking, `LeaveRequest` workflow (DRAFT/PENDING/APPROVED/REJECTED/CANCELLED with idempotent quota deduction and attachment support).
- **Employee Self-Service (`/dashboard/employee`)** — Role-restricted employee portal for viewing profile, submitting/tracking leave requests, and reviewing active contracts.
- **Employee Self-Service (`/dashboard/employee`)** — Role-restricted employee portal for viewing profile, submitting/tracking leave & reimbursement requests, and reviewing active contracts.
- **Extended Audit Log (`apps.audit`)** — Granular audit tracking (CREATE/UPDATE/DELETE/APPROVE/REJECT/ACTIVATE/TERMINATE/RENEW/UPLOAD/DOWNLOAD) with before/after diffs, sensitive field redaction (NIK/NPWP/BPJS/bank), and audit trail UI at `/dashboard/settings/audit-log`.
- **Production & Server Optimization** — Live on VPS under `https://hris.agentlab.my.id` with Nginx reverse proxy & Let's Encrypt SSL; connected to Supabase PostgreSQL (SG region).
- **Validation** — Backend `check` & 66 unit tests pass; Frontend `tsc`, `oxlint`, and `next build` clean.
- **Production & Server Optimization** — Live on VPS (`43.154.128.239`) under `https://hris.feraco.co.id` (with redirect from `hris.agentlab.my.id`) with Nginx reverse proxy & Let's Encrypt SSL; connected to Supabase PostgreSQL (SG region). Server RAM optimized by removing unused legacy containers (~500 MB RAM / ~400 MB Swap freed). Full operational guide documented in `production.md`.
- **Validation** — Backend `check` & 34 recruitment tests pass; Frontend `tsc`, `oxlint`, and `next build` clean.