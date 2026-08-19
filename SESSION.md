# HRIS FERACO - Progress Note

## Status: Employee Database + Supabase PostgreSQL

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

### Frontend
- /dashboard/karyawan -> employee list (table/search/filter/pagination/add). Delete button hidden for HR_STAFF.
- /dashboard/karyawan/[id] -> detail (Overview/Employment/Contracts/History/Documents). Contracts tab: Current Contract card + Add/Edit form (no status dropdown; Simpan Draft vs Activate Contract buttons; document file input uploads + links to contract) + Contract History table (type/number/period/status badge + is_current/current, probation/document). Actions per status: DRAFT→Edit/Activate/Delete(admin), ACTIVE→Edit/Terminate/Delete(admin), EXPIRED/RENEWED/TERMINATED→Delete(admin). Notifications via react-toastify (success/error toasts, backend field errors surfaced as plain message).
- /dashboard/settings/departments -> department master (table/search/status filter/add/edit/activate-deactivate/delete).
- /dashboard/settings/positions -> position master (table/search/dept+status filter/add/edit/activate-deactivate/delete).
- Employee form: department dropdown (active-only) -> cascade fetch positions for selected department -> position dropdown (active-only, "No positions available" when empty).
- /dashboard/overview -> real-data dashboard: 5 summary cards (total/active/inactive employees, departments, positions), Employee Overview table (latest 5), Department Overview (counts), Quick Actions. Frontend aggregation, no dummy data. Removed dummy sections (pending approval, recruitment, payroll, contract expiry, freelance event progress).
- /dashboard/settings/organization -> org structure (departments -> positions).
- /dashboard/settings/users -> user CRUD (add/edit/activate/deactivate/delete, assign role). /dashboard/settings/roles -> role list (read-only). Backend: /api/auth/users (ADMIN only), /api/auth/roles (ADMIN only).
- lib/employees.ts + lib/users.ts API client to Django.

### Validation
- Backend: check pass, 48 tests pass (SQLite; PostgreSQL teardown blocked by pgbouncer ObjectInUse — known).
- Frontend: tsc pass, oxlint pass, next build exit 0.
### Demo login
- admin@feraco.id / password