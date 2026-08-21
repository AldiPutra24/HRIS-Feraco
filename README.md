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

**Leave Module: Filters + Type Seeding + Pagination Fix** — last updated 2026-08-22

- **Backend** — `seed_leave_types` management command seeds 7 leave types idempotently (`get_or_create`). `LeaveTypeViewSet` filters: non-HR SAFE_METHODS see only active types; HR sees all. 3 new tests (seed creates all, idempotent, API active-only for employee). 62 tests pass.
- **Frontend** — `/dashboard/leave` filter dropdowns: Status + Jenis Cuti (all roles), Karyawan (HR/Manager only). Filters update table live, persist in URL query params, Reset button clears. Skeleton loading + empty state. `lib/leaves.ts` `unwrapList` handles DRF paginated `{results}` responses.
- **Validation** — backend `check` pass, 62 tests pass; frontend `tsc`, `oxlint`, `next build` clean.