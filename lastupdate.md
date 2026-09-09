# Last Update — Management Navbar + Access Scope

**Date:** 2026-09-09
**Spec:** `navbar_update.md` (Management-only navbar + backend-enforced data scope)

## Summary

Role MANAGEMENT kini memiliki navbar tersendiri dan akses data yang di-scope
oleh backend (bukan hanya hidden menu). Bawahan ditentukan murni lewat
`Employee.manager` (Reporting To) — bukan department atau parent_position.
Behavior role lain (ADMIN/HR_STAFF/HR_LEAD/EMPLOYEE) tidak berubah.

## Navbar Management (frontend)

`frontend/src/config/nav-config.ts` — new `managementNavGroups` (6 items only):
Dashboard (`/dashboard/management/overview`) · Karyawan (`/dashboard/karyawan`) ·
Leave (`/dashboard/management/leave`) · Reimbursement (`/dashboard/reimbursements`) ·
Payroll (`/dashboard/management/payroll`) · Profile (`/dashboard/settings/account`).

- `app-sidebar.tsx`: pilih `managementNavGroups` saat `user.role === 'management'`
  (logo link + redirect `/dashboard` ikut ke management overview).
- `types/index.ts` + `hooks/use-nav.ts`: `access.roles: string[]` (array) didukung
  selain `access.role` (single) — filtering nav tetap UI-only.
- `app/dashboard/page.tsx`: redirect per role (employee / management / lainnya).

## Backend enforcement (source of truth)

`backend/apps/personnel/permissions.py`
- Helper baru: `employee_for(user)`, `direct_report_ids(user)` → ID karyawan
  dengan `manager = employee milik user` (hanya untuk role MANAGEMENT;
  kosong untuk role lain).
- Permission baru `IsManagementViewer`: MANAGEMENT hanya SAFE_METHODS.

### Karyawan (view-only, bawahan langsung)
`apps/personnel/views.py` — `EmployeeViewSet`:
- `get_queryset()`: MANAGEMENT → `id__in=direct_report_ids(...)` (list maupun
  detail; employee di luar bawahan = 404).
- `_block_management_write()` dipanggil di semua action tulis: perform_create /
  perform_update / import_csv / contracts(POST) / edit / activate / terminate /
  renew / history(POST) / documents(POST) → 403.
- HR roles tidak berubah (filter lama tetap jalan).

### Leave (bawahan, Approve/Reject tetap)
- Queryset scoping sudah ada (`MANAGEMENT` → direct reports + own) — tidak diubah.
- Approve/reject tetap hanya oleh atasan langsung (rule existing).
- `apps/leaves/tests.py` +1 test: list scope (own + report masuk, outsider tidak).

### Reimbursement (view-only, bawahan langsung)
`apps/reimbursement/permissions.py` + `views.py`:
- `get_queryset()`: MANAGEMENT → `employee_id__in=direct_report_ids(...)`; detail
  non-bawahan = 404 (object permission juga menolak).
- `_block_management_write()` di semua action: create / submit / approve /
  reject / mark_paid / cancel / delete / attachment POST / payment_proof POST → 403.
- HR roles tidak berubah.

### Payroll (hanya slip sendiri)
`apps/payroll/views.py` — `PayrollViewSet.get_queryset()`:
- MANAGEMENT → `employee_id = employee milik user` (slip gaji sendiri saja;
  bawahan/employee lain tidak terlihat, `?employee=` filter tidak bisa bypass).
- Read-only viewset — MANAGEMENT memang tidak punya write di payroll.

### Profile (akun sendiri)
- Reuse existing `/dashboard/settings/account` (`AccountSettings`, PATCH
  `/api/auth/me/account/`) — tanpa perubahan.

## Frontend perubahan lain

- `employee-list.tsx`: mode MANAGEMENT — tanpa tombol Tambah/Import/Edit/Delete,
  deskripsi "Data bawahan langsung Anda (hanya lihat)", filter dept/posisi tidak
  dipanggil (queryset backend sudah terbatas).
- `reimbursement-page.tsx`: `canAct = role !== 'management'` → tombol
  Setujui/Tolak/Tandai Dibayar/Hapus disembunyikan untuk MANAGEMENT.
- `features/management/management-payroll.tsx` (baru): slip gaji pribadi per
  periode (read-only, reuse `listPeriods`/`listPayrolls`).
- `app/dashboard/management/payroll/page.tsx` (baru): route page.
- `management-overview.tsx`: quick links ke Karyawan (Bawahan), Reimbursement,
  Payroll Saya.

## Test (backend, `DB_ENGINE=sqlite`)

Test baru (22):
- `personnel.tests.ManagementEmployeeScopeTests` (9): hanya bawahan di list;
  detail non-bawahan 404; detail bawahan 200; create/update/delete/import 403;
  add contract 403; HR masih lihat semua.
- `reimbursement.tests.ManagementScopeTests` (7): list hanya bawahan;
  approve/reject/mark_paid/delete/create 403; detail non-bawahan 404; HR approve OK.
- `payroll.tests.ManagementPayrollScopeTests` (5): hanya slip sendiri (report dan
  outsider tidak ada); detail sendiri 200, lain 404; `?employee=` tidak bocor;
  HR lihat semua.
- `leaves.tests`: +1 list scope test (approve/reject test sudah ada sebelumnya).

Hasil run per modul:
- personnel: 93 tests — 1 error `test_import_xlsx` **pre-existing** (diverifikasi
  sama-sama gagal di clean tree via `git stash`; TransactionManagementError di
  import_csv, di luar scope ini).
- leaves + accounts: 52 OK · reimbursement: 42 OK · payroll: 37 OK.
- audit + announcements + recruitment: 50 OK.
- onboarding (tidak berubah, dijalankan per class karena lama >580s di mesin
  ini): 64 + 19 + 16 + 50 OK.

## Test (frontend)

- `tsc --noEmit`: 0 error.
- `next build`: sukses (termasuk route baru `/dashboard/management/payroll`).
- `oxlint`: 2 error `set-state-in-effect` pada file baru — pattern yang sama
  dengan konvensi codebase existing (documented di SESSION.md; file lama seperti
  `management-overview.tsx` juga memilikinya).

## Catatan

- Bawahan = `Employee.manager` langsung saja (bukan bertingkat/rekursif), sesuai spec.
- Tidak ada perubahan model/migrasi.
- Tidak ada perubahan behavior role ADMIN/HR_STAFF/HR_LEAD/EMPLOYEE.
- `SESSION.md` di-update dengan progress yang sama.
