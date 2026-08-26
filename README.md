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

**Audit Log (Extended) + Leave Module Polish** — last updated 2026-08-26

- **Backend** — `AuditLog` extended with APPROVE/REJECT/ACTIVATE/TERMINATE/RENEW/UPLOAD/DOWNLOAD actions + `changes_before`/`changes_after`/`metadata` (JSON) + `user_agent`. `log_event` sanitizes sensitive fields (password/secret/token/nik/npwp/bpjs/rekening) and `diff_changes` records only changed fields for UPDATE. Read API `/api/audit/audit-logs/` (ADMIN/HR_LEAD only) with action/user/module/entity/date filters. Employee UPDATE captures before/after; contract activate/terminate/renew, document upload/download, leave approve/reject log semantic actions. Soft-delete: Employee → INACTIVE, Department/Position → `is_active=False` (no hard deletes).
- **Frontend** — `/dashboard/settings/audit-log` page (filter bar + table Time/Actor/Action/Module/Object/Detail + click-to-expand before/after). Employee Detail History tab shows "Audit Trail" for that employee. `seed_leave_types` + leave-type dropdown now correct on Supabase Postgres.
- **Validation** — backend `check` pass, 66 tests pass; frontend `tsc`, `oxlint`, `next build` clean.