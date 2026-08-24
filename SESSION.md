# HRIS FERACO - Progress Note

## Status: Employee Database + Leave Module

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

### Validation
- Backend: check pass, 62 tests pass (SQLite; PostgreSQL teardown blocked by pgbouncer ObjectInUse — known).
- Frontend: tsc pass, oxlint pass, next build exit 0.

### Demo login
- admin@feraco.id / password
