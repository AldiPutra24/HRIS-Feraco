# HRIS Feraco

Internal Human Resource Information System.

- **Frontend** - Next.js 16 (App Router), TypeScript, Tailwind CSS v4, shadcn/ui on Base UI. See `frontend/`.
- **Backend** - Django + Django REST Framework, PostgreSQL, session/cookie auth, RBAC, audit log. See `backend/`.

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

## Last Progress

**Employee Self-Service Dashboard + User↔Employee Link** — last updated 2026-08-24

- **Backend** — `UserAdminSerializer` links a user to an Employee (`employee` write-only PK; one user↔one employee; name/email/username auto-filled from Employee). `GET /api/auth/me/employee/` + `GET /api/auth/me/employee/contracts/` self-service endpoints. `LeaveBalanceViewSet` scopes non-HR to own balances. Leave attachment GET+POST merged into one `attachment` action (fixed 405 route collision).
- **Frontend** — role-based nav: EMPLOYEE sees `/dashboard/employee` (Overview/Profile/Izin & Cuti/Kontrak), HR/Admin sees existing dashboard. `ProtectedRoute` enforces role-route isolation. Leave submit form moved to `/dashboard/employee/leave/new`; HR `/dashboard/leave` is list-only. Users page: Karyawan dropdown (EMPLOYEE role only), single "Nama" field.
- **Validation** — backend `check` pass, 62 tests pass; frontend `tsc`, `oxlint`, `next build` clean.