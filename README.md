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

**Production Environment & Core Modules Summary** — last updated 2026-08-28

- **Employee & Contract Lifecycle** — Employee CRUD, Department & Position masters, contract management (PKWT/PKWTT, system-managed status DRAFT/ACTIVE/EXPIRED/TERMINATED/RENEWED), employment history, and employee documents stored in Supabase Storage (signed download URLs).
- **Leave Module (`apps.leaves`)** — Configurable `LeaveType`, annual `LeaveBalance` tracking, `LeaveRequest` workflow (DRAFT/PENDING/APPROVED/REJECTED/CANCELLED with idempotent quota deduction and attachment support).
- **Employee Self-Service (`/dashboard/employee`)** — Role-restricted employee portal for viewing profile, submitting/tracking leave requests, and reviewing active contracts.
- **Extended Audit Log (`apps.audit`)** — Granular audit tracking (CREATE/UPDATE/DELETE/APPROVE/REJECT/ACTIVATE/TERMINATE/RENEW/UPLOAD/DOWNLOAD) with before/after diffs, sensitive field redaction (NIK/NPWP/BPJS/bank), and audit trail UI at `/dashboard/settings/audit-log`.
- **Production & Server Optimization** — Live on VPS under `https://hris.agentlab.my.id` with Nginx reverse proxy & Let's Encrypt SSL; connected to Supabase PostgreSQL (SG region).
- **Validation** — Backend `check` & 66 unit tests pass; Frontend `tsc`, `oxlint`, and `next build` clean.