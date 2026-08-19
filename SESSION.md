# HRIS FERACO - Progress Note

## Status: Employee Database + Supabase PostgreSQL

### Backend
- Supabase PostgreSQL primary (settings reads SUPABASE_DB_* + SUPABASE_URL/SECRET_KEY). SQLite fallback via DB_ENGINE=sqlite for local/tests.
- personnel models: Personnel (biodata + BPJS extensible), Employee (ACTIVE/INACTIVE), EmployeeContract (PKWT/PKWTT/PROBATION), EmploymentHistory (PROMOTION/TRANSFER/POSITION_CHANGE), EmployeeDocument (metadata only), Department, Position.
- Supabase Storage private bucket via service key; binary never in DB.
- API: /api/employees (CRUD + contracts/history/documents actions), /api/departments (CRUD ModelViewSet), /api/positions (CRUD ModelViewSet). Pagination/search/filter/ordering + RBAC (IsHRStaff).
- Department model: name (unique), code, is_active, created_at, updated_at. Inactive dept rejected for employee create/update (validate_department). DELETE blocked when dept has employees (perform_destroy).
- Position model: name, code, is_active, created_at, updated_at; unique_together (name, department). Inactive position rejected (validate_position); cross-field validate rejects position whose department != employee.department. DELETE blocked when position has employees (perform_destroy).
- Sensitive fields (nik/bank/npwp/bpjs) masked for non-privileged roles.

### Frontend
- /dashboard/karyawan -> employee list (table/search/filter/pagination/add).
- /dashboard/karyawan/[id] -> detail (Overview/Employment/Contracts/History/Documents).
- /dashboard/settings/departments -> department master (table/search/status filter/add/edit/activate-deactivate/delete).
- /dashboard/settings/positions -> position master (table/search/dept+status filter/add/edit/activate-deactivate/delete).
- Employee form: department dropdown (active-only) -> cascade fetch positions for selected department -> position dropdown (active-only, "No positions available" when empty).
- /dashboard/overview -> real-data dashboard: 5 summary cards (total/active/inactive employees, departments, positions), Employee Overview table (latest 5), Department Overview (counts), Quick Actions. Frontend aggregation, no dummy data. Removed dummy sections (pending approval, recruitment, payroll, contract expiry, freelance event progress).
- /dashboard/settings/organization -> org structure (departments -> positions).
- /dashboard/settings/users -> user CRUD (add/edit/activate/deactivate/delete, assign role). /dashboard/settings/roles -> role list (read-only). Backend: /api/auth/users (ADMIN only), /api/auth/roles (ADMIN only).
- lib/employees.ts + lib/users.ts API client to Django.

### Validation
- Backend: check pass, 42 tests pass (33 personnel + 9 accounts; SQLite; PostgreSQL teardown blocked by pgbouncer ObjectInUse — known).
- Frontend: tsc pass, oxlint pass, next build exit 0.

### Demo login
- admin@feraco.id / password