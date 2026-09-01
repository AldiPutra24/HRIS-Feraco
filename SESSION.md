# HRIS FERACO - Progress Note

## Status: Leave Module — Admin Hard Delete (Phase 2.1)

### Leave hard delete (`apps.leaves`) — 02 Sep 2026
- Admin/superadmin can permanently delete leave requests (data cuti) on `/dashboard/leave`.
- `LeaveRequestViewSet.destroy` override + `@action(detail=True, methods=['delete'], url_path='hard-delete')` — both restricted to `is_superuser or role == 'ADMIN'` (403 otherwise, incl. HR_STAFF/HR_LEAD/owner). Fixes pre-existing hole where request owner could DELETE own request via plain `DELETE /requests/{id}/`.
- **Balance restore**: hard-deleting an APPROVED request with `balance_deducted=True` restores quota on the target type (`deducts_from or leave_type`): `used_days -= total_days`, recompute `remaining_days`, inside `transaction.atomic`.
- `LeaveNotification` rows cascade (FK on_delete=CASCADE). Audit: `log_event(..., 'delete', obj=None, description=f'Leave request {id} hard-deleted')`.
- Tests: 27 leaves tests pass (4 new: non-admin 403, superadmin 204, balance restored, plain-DELETE admin-only).
- Frontend: `src/lib/leaves.ts` `hardDeleteLeave(id)` (DELETE `/requests/{id}/hard-delete/`); `leave-page.tsx` "Hapus" button shown only for `role === 'admin'` + confirm modal ("Hapus Permanen" destructive / "Batal"), toast + reload after delete.

## Status: Leave Module — HR Business Rules (Phase 2)

### Leave Business Rules (`apps.leaves`) — 01 Sep 2026
- 6 new `LeaveType` fields (migration `0004`): `max_days_per_request` (per-request duration cap), `min_tenure_months` (tenure eligibility), `max_days_without_attachment` (attachment mandatory above this many days), `carry_forward_max` (unused days carried to next year, capped), `deducts_from` (self-FK — deduct from another type's balance, e.g. Cuti Berobat uses Cuti Tahunan), `is_paid`. `None/0` = rule not enforced for that type.
- **Carry-forward** in `services.get_balance()`: on first balance row creation for a year, carries up to `carry_forward_max` unused days from previous year's balance (e.g. ANNUAL: unused 2025 days carry into 2026, capped at 3).
- **`deducts_from` deduction** in `apply_approval_deduction()`: quota deducted from target type's balance (`leave_type.deducts_from or leave_type`); still idempotent via `balance_deducted` flag; `allocated_days==0` (unlimited types) skip deduction.
- **Serializer validation** (`LeaveRequestSerializer.validate`, create only): tenure check via `employee.join_date` months vs `min_tenure_months`; per-request cap `total_days > max_days_per_request` → 400; attachment rules — `requires_attachment` OR (`max_days_without_attachment` and days exceed threshold, e.g. Izin Sakit: 1 day free, >1 day needs doctor's note); quota check against the **target** type's balance (`deducts_from or leave_type`).
- **`seed_leave_types` command**: 13 types via `get_or_create` (idempotent) — 9 LEAVE (ANNUAL 12d/quota carry-3 max-3d/3mo tenure; MATERNITY 90d; MARRIAGE 3d; MISCARRIAGE 45d+attach; MEDICAL→deducts ANNUAL; VACCINE 1d; PATERNITY 3d; CHILD_CIRCUMCISION 2d; SPECIAL unlimited) + 4 PERMISSION (SICK max-no-attach 1d unpaid; FAMILY/PERSONAL/LATE unpaid). `deducts_from` re-pointed after create (self-referential FK). Cuti Tidak Berbayar = no category; note in reason, HR handles at approval.
- `admin.py`: LeaveType list_display + filter/sort by new rule fields.
- Tests: 23 leaves tests pass (7 new `BusinessRuleTests`: max-days cap, min tenure, sick doctor's note, requires attachment, MEDICAL→ANNUAL deduct, carry-forward capped, unpaid permission; existing workflow/seed tests unchanged).
- Frontend: `src/lib/leaves.ts` `LeaveType` type extended with the 6 new fields (consumers unchanged).
- **Turbopack icon fix**: 5 shadcn ui components (`checkbox/sheet/breadcrumb/dropdown-menu/sidebar`) switched from named `import { IconX } from '@tabler/icons-react'` to the centralized `Icons.xxx` object (`Icons.check/close/chevronRight/dots/panelLeft`) — `icons.tsx` exports only the `Icons` object, no named exports; named imports broke Turbopack static analysis (`Export IconCheck doesn't exist`). Dev server 200, tsc/oxlint clean.
- Validation: backend `manage.py check` + 23 leaves tests OK; frontend tsc clean.

## Status: Recruitment — Candidate Inbox + Pipeline V1

### Recruitment (`apps.recruitment`) — 31 Aug 2026
- Job management (DRAFT/OPEN/CLOSED, system-managed status, public portal `/jobs/{slug}` apply form with optional CV upload) + Candidate Inbox + Candidate Pipeline V1.
- Candidate Inbox: `Candidate.status` field (default `APPLIED`, migration 0003), CV upload via `perform_create` to Supabase Storage bucket `recruitment-cvs` (signed URLs), filters job/status, detail page `/dashboard/recruitment/candidates/[id]`, job→applications deep-link, nav item.
- Pipeline V1: 9 statuses (`APPLIED/SCREENING/INTERVIEW_HR/INTERVIEW_USER/INTERVIEW_GM/OFFERING/OFFER_ACCEPTED` + terminal `REJECTED/WITHDRAWN`). `Candidate.TRANSITIONS` map (APPLIED→SCREENING→INTERVIEW_HR→INTERVIEW_USER→INTERVIEW_GM→OFFERING→OFFER_ACCEPTED; APPLIED may skip to INTERVIEW_HR; each step may go REJECTED/WITHDRAWN; terminal = no further transitions). Backend is source of truth.
- `CandidateStatusHistory` model (candidate/from_status/to_status/changed_by/changed_at/note, migration 0004). `services.transition_candidate()` validates against map, writes history + AuditLog (`log_event` action='update').
- `POST /api/recruitment/candidates/{id}/transition/` action — HR-only via `IsRecruitmentAdmin` (ADMIN/HR_STAFF/HR_LEAD); invalid status → 400, invalid transition → 400, terminal → 400.
- CandidateSerializer exposes `next_statuses` (sorted allowed) + `status_history` (with `changed_by_name` via `get_username()` — User model has NO `name` field).
- Frontend: `candidate-pipeline.ts` (shared PIPELINE/ALL_STATUSES/statusLabel); detail page = pipeline stepper + current status badge + next-status action buttons (Reject=destructive, Withdraw=outline) + optional note + status history timeline; list page filter = all 9 statuses (labeled); per-job kanban view `RecruitmentJobPipeline` (plain flex columns, no new lib) at `/dashboard/recruitment/jobs/[id]/applications` + existing table below.
- Tests: 34 recruitment tests pass (valid transitions, full flow, invalid rejected, reject, withdraw, terminal lock, history actor, RBAC 403, next_statuses). Deployed to prod (commit 853d371, migration 0004 applied).
- Note: `OFFER_ACCEPTED` = candidate accepted offer only. Onboarding/Employee conversion NOT implemented yet — candidate stays linked to Job.

### Backend
- Supabase PostgreSQL primary (settings reads SUPABASE_DB_* + SUPABASE_URL/SECRET_KEY). SQLite fallback via DB_ENGINE=sqlite for local/tests.
- personnel models: Personnel (biodata + BPJS extensible), Employee (ACTIVE/INACTIVE), EmployeeContract (PKWT/PKWTT + status DRAFT/ACTIVE/EXPIRED/TERMINATED/RENEWED), EmploymentHistory (PROMOTION/TRANSFER/POSITION_CHANGE), EmployeeDocument (metadata only), Department, Position.
- EmployeeContract: contract_type (PKWT/PKWTT, no PROBATION), contract_number (unique), start_date, end_date, probation_enabled + probation dates, status (system-managed), termination_date/termination_reason, notes, document (latest EmployeeDocument). Renewal creates NEW record, marks old RENEWED (never overwrite). Expired contract does NOT flip employee to INACTIVE (employee status separate).
- Contract status is system-managed: user never sets status. New = DRAFT; `activate:true` (or activate action) → ACTIVE (sole current via `set_current_contract`). `set_current_contract` now marks the new contract RENEWED when the employee already has an unexpired ACTIVE contract (becomes ACTIVE later via `sync_contract_status` once current expires); otherwise new → ACTIVE and other ACTIVE → RENEWED. `sync_contract_status()` flips ACTIVE with past end_date → EXPIRED + promotes latest valid RENEWED → ACTIVE for any employee with no ACTIVE. terminate action → TERMINATED (+ termination_date/reason). `is_current` property = ACTIVE && (no end_date || end_date >= today). Only one current per employee enforced in backend.
- Add contract validation: when an ACTIVE contract exists, new contract `start_date` must be > that ACTIVE contract's `end_date` (400 with Indonesian message otherwise).
- personnel/services.py: `sync_contract_status()` + `set_current_contract(contract)` (transactional, demotes other ACTIVE to RENEWED).
- Contract API actions: POST contracts (Simpan Draft / Activate via `activate`), PATCH contracts/{pk}/edit/ (DRAFT/ACTIVE), POST contracts/{pk}/activate/, POST contracts/{pk}/terminate/, POST contracts/{pk}/renew/ (unused by frontend).
- Supabase Storage private bucket via service key; binary never in DB.
- API: /api/employees (CRUD + contracts/history/documents actions), /api/departments (CRUD ModelViewSet), /api/positions (CRUD ModelViewSet). Pagination/search/filter/ordering + RBAC (IsHRStaff).
- RBAC: HR_STAFF = create/edit only (no DELETE) on employees; delete employee/contract/document = ADMIN (contract delete admin-only, document delete admin-only); HR_LEAD + ADMIN can delete employees.
- Document download: GET /api/documents/{id}/download/ → 302 redirect to signed Supabase URL (renders file in browser directly).
- DELETE /api/employees/{id}/contracts/{contract_pk}/ (admin-only), DELETE /api/employees/{id}/documents/{doc_pk}/ (admin-only, removes storage object + metadata).
- POST /api/employees/{id}/contracts/{contract_pk}/renew/ — renews ACTIVE contract (marks old RENEWED, creates new record).
- Department model: name (unique), code, is_active, created_at, updated_at. Inactive dept rejected for employee create/update (validate_department). DELETE blocked when dept has employees (perform_destroy).
- Position model: name, code, is_active, created_at, updated_at; unique_together (name, department). Inactive position rejected (validate_position); cross-field validate rejects position whose department != employee.department. DELETE blocked when position has employees (perform_destroy).
- Sensitive fields (nik/bank/npwp/bpjs) masked for non-privileged roles.
- Leave module (`apps.leaves`): LeaveType, LeaveBalance (unique_together employee+leave_type+year), LeaveRequest (status DRAFT/PENDING/APPROVED/REJECTED/CANCELLED + `balance_deducted` flag), LeaveNotification. Roles: LEAVE_ADMIN_ROLES={ADMIN,HR_STAFF,HR_LEAD}, APPROVER_ROLES adds MANAGEMENT.
- `seed_leave_types` management command: seeds 7 leave types (ANNUAL/Cuti Tahunan, SICK/Cuti Sakit, MATERNITY, PATERNITY, MARRIAGE, BEREAVEMENT, UNPAID) via `get_or_create` — idempotent.
- `LeaveTypeViewSet.get_queryset`: non-HR SAFE_METHODS see only `is_active=True`; HR roles (LEAVE_ADMIN_ROLES) see all.
- `LeaveRequestSerializer.validate` resolves `employee` from request user (`_employee_for(request.user)`) when missing from `attrs`/`instance`. Fixes read-only `employee` always 400'ing "Karyawan wajib diisi" on create; submit returns 201. `perform_create` passes `employee=_employee_for(request.user)` via `serializer.save(employee=...)`; submission rejected if logged-in user has no linked Personnel/Employee (personnel `user_id=None`). Quota check: total_days > remaining_days → 400. Attachment required when `leave_type.requires_attachment`. Approval deduction idempotent via `balance_deducted` flag (skips `allocated_days==0`).
- Leave attachment GET+POST merged into a single `@action(detail=True, methods=['get','post'], url_path='attachment')` (two actions sharing `url_path='attachment'` caused route collision → POST 405). POST → upload, GET → signed-url download.
- Self-service endpoints: `GET /api/auth/me/employee/` (own Employee profile, masked sensitive fields) + `GET /api/auth/me/employee/contracts/`. `LeaveBalanceViewSet.get_queryset` scopes non-HR to own balances via `_employee_for`.
- `UserAdminSerializer`: `employee` write-only PK (one user↔one employee via `validate_employee`); read-only `employee_id`/`employee_name`; `validate` auto-fills name/email/username from Employee; `create`/`update` bind `employee.user`.
- Dev DB note: `admin@feraco.id` is a pure superadmin (no Personnel/Employee link — unlinked from Andi Pratama). Create an EMPLOYEE-role user via Users page to test self-service.

### Frontend
- /dashboard/karyawan -> employee list (table/search/filter/pagination/add). Delete button hidden for HR_STAFF.
- /dashboard/karyawan/[id] -> detail (Overview/Employment/Contracts/History/Documents). Contracts tab: Current Contract card + Add/Edit form (no status dropdown; Simpan Draft vs Activate Contract buttons; document file input uploads + links to contract) + Contract History table (type/number/period/status badge + is_current/current, probation/document). Actions per status: DRAFT→Edit/Activate/Delete(admin), ACTIVE→Edit/Terminate/Delete(admin), EXPIRED/RENEWED/TERMINATED→Delete(admin). Notifications via react-toastify (success/error toasts, backend field errors surfaced as plain message).
- /dashboard/settings/departments -> department master (table/search/status filter/add/edit/activate-deactivate/delete).
- /dashboard/settings/positions -> position master (table/search/dept+status filter/add/edit/activate-deactivate/delete).
- Employee form: department dropdown (active-only) -> cascade fetch positions for selected department -> position dropdown (active-only, "No positions available" when empty).
- /dashboard/overview -> real-data dashboard: 5 summary cards (total/active/inactive employees, departments, positions), Employee Overview table (latest 5), Department Overview (counts), Quick Actions. Frontend aggregation, no dummy data. Removed dummy sections (pending approval, recruitment, payroll, contract expiry, freelance event progress).
- /dashboard/settings/organization -> org structure (departments -> positions).
- /dashboard/settings/users -> user CRUD (add/edit/activate/deactivate/delete, assign role). /dashboard/settings/roles -> role list (read-only). Backend: /api/auth/users (ADMIN only), /api/auth/roles (ADMIN only).
- User form: Karyawan dropdown appears only when Role = EMPLOYEE (auto-fills name/email/username); single "Nama" field (Nama Depan/Belakang removed). Account link status shown in table (Not Created / employee badge).
- Employee self-service `/dashboard/employee` (EMPLOYEE role only): Overview (sisa kuota/pending/approved/kontrak + recent requests), Profile (name/email/dept/position/manager/join/status — no NIK/rekening/NPWP), Izin & Cuti (Pengajuan Saya + Ajukan Cuti), Kontrak (current contract). Role-based nav: `employeeNavGroups` in nav-config; `ProtectedRoute` forces employees under `/dashboard/employee` and blocks non-employees from it.
- /dashboard/leave = HR list-only page: Status/Jenis Cuti/Karyawan filters (Karyawan filter HR/Manager only) + request table (Setujui/Tolak/Batal actions) + Sisa Kuota (admin). Filters persist in URL params, Reset clears. Skeleton loading + empty state. "Ajukan Cuti" button removed (form only at `/dashboard/employee/leave/new`).
- `features/leaves/leave-form.tsx` `LeaveForm` accepts `redirectTo` prop — standalone form (jenis cuti select, start/end date, lampiran file, alasan) → `createLeaveRequest` + optional `uploadLeaveAttachment` → toast + redirect.
- `lib/leaves.ts`: `unwrapList<T>` handles both array and `{results}` paginated responses (DRF global PAGE_SIZE=20); `listLeaveRequests(params)` passes status/leave_type/employee; `listBalances()` unwraps too. Employees for Karyawan filter via `listEmployees({ employment_status: 'ACTIVE', page_size: '1000' })`.
- lib/employees.ts + lib/users.ts API client to Django.

### Audit Log
- `AuditLog` extended: new actions APPROVE/REJECT/ACTIVATE/TERMINATE/RENEW/UPLOAD/DOWNLOAD (plus existing CREATE/UPDATE/DELETE/LOGIN/LOGOUT/permission_change/role_change); fields `changes_before`, `changes_after`, `metadata` (JSONField), `user_agent`. Migration `0002_auditlog_fields`.
- `apps/audit/services.py`: `log_event` now records `user_agent` + sanitized changes/metadata; `_sanitize` redacts sensitive keys (password/secret/token/api_key/nik/npwp/bpjs/bank_account_number) recursively; `diff_changes(old,new)` returns only changed fields; `log_model_update` convenience.
- `EmployeeViewSet.perform_update` captures before/after via `EmployeeSerializer` and passes to `log_event` (changes_before/after). Contract actions now log semantic actions: activate→'activate', terminate→'terminate', renew→'renew'. Document upload→'upload'; DocumentDownloadView + leave attachment download→'download'. Leave approve/reject→'approve'/'reject'; leave attachment upload→'upload'.
- Audit read API: `AuditLogViewSet` (ReadOnly) at `/api/audit/audit-logs/`, permission `IsAuditViewer` (ADMIN/HR_LEAD only). Filters: action, user, module (content_type app_label), entity_type (model), entity_id, date_from/date_to. Paginated (DRF default 20).
- Soft-delete: Employee `perform_destroy` → sets `status=INACTIVE` + `employment_status=INACTIVE` (keeps contracts/history/documents). Department/Position `perform_destroy` → `is_active=False` (blocked if in-use). No hard deletes.
- Frontend `/dashboard/settings/audit-log`: filter bar (actor/action/module/date range + Terapkan/Reset), table (Time/Actor/Action/Module/Object/Detail), click row → detail card (before/after JSON + IP/UA). `lib/audit.ts` client + `AUDIT_ACTIONS`.
- Employee Detail History tab: "Audit Trail" card listing audit entries for that employee (entity_type=employee, entity_id=id).

### Validation
- Backend: check pass, 66 tests pass (SQLite; PostgreSQL teardown blocked by pgbouncer ObjectInUse — known).
- Frontend: tsc pass, oxlint pass, next build exit 0.

### Production Environment & Maintenance (28 Aug 2026)
- Production VPS (`43.154.128.239`, user `ubuntu`) inspected and healthy:
  - Domain updated to `https://hris.feraco.co.id` with valid Let's Encrypt SSL (expiry 26 Nov 2026) and 301 redirect from old domain `hris.agentlab.my.id`.
  - Frontend (`hris-feraco-frontend-1` on `:3000`), Backend (`hris-feraco-backend-1` on `:8000`), and PostgreSQL (`hris-feraco-postgres-1`) running via Docker Compose (`docker-compose.prod.yml`).
  - Nginx reverse proxy serving `https://hris.feraco.co.id`.
  - Django production connected to Supabase PostgreSQL (Singapore region `aws-0-ap-southeast-1.pooler.supabase.com`).
- Server Resource Optimization:

### Demo login
- admin@feraco.id / password

### Frontend Auth — Session Expiry Handling (28 Aug 2026)
- Centralized 401/403 handling in the auth/API layer — no per-page logic.
- New `src/lib/session-events.ts`: module-level handler + `emitSessionExpired()` (no-ops on `/login` to avoid redirect loop; SSR-safe via `typeof window` guard).
- `getCurrentUser()` (`auth-client.ts`) emits `sessionExpired` on 401/403 from `/api/auth/me/`, returns `null` (other non-OK statuses → `null` without event; network errors swallowed).
- `apiClient()` (`api-client.ts`) also emits on any 401/403 (covers other endpoints like `/api/employees/`).
- `AuthProvider`: subscribes to session-expired event → `clearSession()` (user=null, isAuthenticated=false); new `isAuthenticated` state (explicit, distinct from `user`), set on init/login/refresh; new `refresh()` method re-fetches current user.
- `ProtectedRoute`: guards on `isAuthenticated` (not just `user`), renders spinner while `isLoading || !isAuthenticated` (never renders protected UI during transition), redirects `/login?returnUrl=<path>` only when `!isLoading && !isAuthenticated`, preserves intended destination (existing `returnUrl` flow in login-form).
- Normal API errors (400/404/500) never treated as logout.
- Validation: tsc, oxlint, next build clean; backend 66 tests OK; session-events self-check passed (fires on protected path, suppressed on /login, cleared handler no-op).

## Reimbursement Module (31 Aug 2026)

### Backend (`apps.reimbursement`)
- Models: `ReimbursementCategory` (name/code/is_active/requires_attachment), `Reimbursement` (employee FK, category FK, transaction_date, amount Decimal(14,2), description, attachment fields, status DRAFT/PENDING/APPROVED/REJECTED/PAID/CANCELLED, submitted/approved/rejected/paid_at, reviewer FK, rejection_reason, payment_reference, timestamps), `ReimbursementNotification` (in-app only).
- RBAC: `REIMBURSEMENT_ADMIN_ROLES={ADMIN,HR_STAFF,HR_LEAD}`. HR sees all, employee only own (queryset scoping → others' = 404).
- `ReimbursementViewSet` actions: submit (DRAFT→PENDING), approve (PENDING→APPROVED), reject (PENDING only, reason required), mark_paid (APPROVED→PAID, payment_reference required), cancel (DRAFT/PENDING→CANCELLED), attachment (GET signed URL / POST upload to Supabase Storage), notifications. Self-approval & self-reject blocked.
- Attachment validation enforced at **submit**, not create — flow is create (no file) → upload → submit. Fix: removed `requires_attachment` check from serializer create.
- Storage: private bucket `settings.REIMBURSEMENT_STORAGE_BUCKET` (`reimbursement-documents` prod / `reimbursement-documents-dev` dev); binary never in DB.
- `seed_reimbursement_categories` command: 5 categories (TRANSPORT/MEDICAL/MEAL/LODGING/OTHER) via `get_or_create` — idempotent; added to `docker-compose.prod.yml` startup chain.
- Mounted at `/api/reimbursements/` (router: categories + '').

### Frontend
- `lib/reimbursements.ts` API client (categories/list/create/submit/approve/reject/mark_paid/cancel/upload/notifications) — same pattern as `lib/leaves.ts` (`unwrapList`, CSRF cookie).
- HR page `/dashboard/reimbursements` (`features/reimbursement/reimbursement-page.tsx`): status/category/employee filters, table, approve/reject (reason required)/mark_paid (reference required) modals, skeletons.
- Employee `/dashboard/employee/reimbursement` (`employee-reimbursement.tsx`): stats cards (pending count, total paid), history table, cancel draft/pending, rejection reason display. `/new` (`reimbursement-form.tsx`): category/date/amount/attachment/description → create → upload → submit → PENDING. DRAFT rows only "Hapus" (no draft-resume).
- Nav (`nav-config.ts`): employee group "Reimbursement" (Pengajuan Saya / Ajukan Reimbursement); HR group `/dashboard/reimbursements`. Icon `receipt`. Old `/dashboard/reimbursement` placeholder route removed.
- Validation: tsc, oxlint, next build clean (routes include both reimbursement pages).

### Validation
- Backend: full suite 85 tests OK (reimbursement 20: workflow, RBAC, self-approval block, attachment-at-submit, notifications, audit).
- Frontend: tsc pass, oxlint pass, next build exit 0.

## Recruitment Module (31 Aug 2026)

### Backend (`apps.recruitment`)
- Models: `Job` (title/slug unique/description/requirements/employment_type FULL_TIME/PART_TIME/CONTRACT/INTERNSHIP/location/open_date/close_date/status DRAFT/OPEN/CLOSED/created_by/timestamps; slug unique, related dept+position), `Candidate` (job FK/applications, full_name/email/phone/cv_name/cv_path/cv_content_type/source PORTAL/REFERRAL/WEBSITE/OTHER). `Job.is_open()` = OPEN && close_date not past; `Job.is_complete()` = all `REQUIRED_FIELDS` (title/department/position/description/requirements/employment_type/location/open_date) filled.
- **Status system-managed** (backend source of truth): `status` read-only in serializer. Create/update: complete → OPEN, else DRAFT. CLOSED never auto-reopens. `open`/`reopen` actions guard `is_complete()` → 400 if incomplete.
- RBAC: `RECRUITMENT_ADMIN_ROLES={ADMIN,HR_STAFF,HR_LEAD}` via `IsRecruitmentAdmin`. Public endpoints AllowAny.
- Serializers: `JobSerializer` (department_name/position_name/applications_count; status read-only), `JobPublicSerializer` (only id/title/slug/dept/position/description/requirements/type/location/dates — NO status/created_by), `CandidateSerializer` (`validate_job` rejects non-open job; cv_url).
- Views: `JobViewSet` (CRUD + open/close/reopen actions; DELETE only DRAFT; unique slug generator `_unique_slug`), `PublicJobViewSet` (ReadOnly, OPEN only, excludes expired close_date, lookup by slug, no pagination), `CandidateViewSet` (create AllowAny; list/retrieve HR; cv GET signed URL / POST upload to Supabase Storage `_bucket()` = `RECRUITMENT_STORAGE_BUCKET` default `recruitment-cvs`).
- Mounted at `/api/recruitment/` (jobs + candidates) + `/api/recruitment/public/jobs/{slug}/`.
- Audit via existing `log_event`: create/update/delete + 'approve' for open/reopen, 'close' for close (AuditLog has no open/reopen action → reuse approve).
- Supabase bucket `recruitment-cvs` created (private, pdf/jpg/png/doc/docx, 5MB) — prod container default bucket.
- Tests: 23 (Job CRUD/RBAC/duplicate slug/open-close-reopen/delete-draft-only/expired close date hidden/system-status: incomplete→DRAFT, frontend cannot force status, complete DRAFT→OPEN, CLOSED not public even if complete).

### Frontend
- `lib/recruitment.ts` API client (jobs list/get/create/update/delete/open/close/reopen, candidates list/apply, public jobs get/list; `unwrapList` for paginated; `JobInput` has NO status field).
- HR page `/dashboard/recruitment/jobs` (`features/recruitment/recruitment-jobs-page.tsx`): title/department/position/type/location/open+close date/status/application count/Public URL (Copy Link only when OPEN) columns; search + status filter (URL params); Add/Edit modal form — **no Status field**; actions per status: DRAFT→Edit/Open/Delete, OPEN→Edit/Close, CLOSED→Edit/Reopen.
- Public portal `/jobs/[slug]` (`features/recruitment/public-job-page.tsx`): no auth, shows dept/position/type/location/dates/description/requirements + apply form (name/email/phone → `applyJob` POST); 404 via `notFound()` for non-OPEN. Public data never exposes internal HR fields.
- `/dashboard/recruitment` redirects → `/dashboard/recruitment/jobs`.
- CV upload not yet wired into public apply form (backend `/api/recruitment/candidates/{id}/cv/` ready) — pending.
- Validation: tsc, oxlint, next build clean.

### Validation
- Backend: 23 recruitment tests OK (full suite 108+).
- Frontend: tsc pass, oxlint pass, next build exit 0.
- Deployed: VPS rebuild, Supabase bucket `recruitment-cvs` created, `GET /api/recruitment/public/jobs/` → 200 live.
