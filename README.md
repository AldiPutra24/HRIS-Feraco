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

**Recruitment Module — Candidate Inbox + Pipeline V1** — last updated 2026-08-31

- **Candidate Pipeline V1 (`apps.recruitment`)** — 9 statuses (`APPLIED/SCREENING/INTERVIEW_HR/INTERVIEW_USER/INTERVIEW_GM/OFFERING/OFFER_ACCEPTED` + terminal `REJECTED/WITHDRAWN`). Backend-enforced transition map (`Candidate.TRANSITIONS`) — no arbitrary jumps; `POST /api/recruitment/candidates/{id}/transition/` (HR-only RBAC) writes `CandidateStatusHistory` (from/to/changed_by/note) + AuditLog per change. `APPLIED` may skip to `INTERVIEW_HR`; terminal statuses have no further transitions. Candidate detail shows pipeline stepper, next-status action buttons (Reject/Withdraw), optional note, and status history timeline. Candidate list filters all statuses + job. Per-job kanban view (no new lib — plain flex columns) at `/dashboard/recruitment/jobs/{id}/applications`. Migration `0004`. 34 recruitment tests.
- **Candidate Inbox** — CV upload to Supabase Storage bucket `recruitment-cvs` (signed download URLs), `Candidate.status` field (default `APPLIED`), list filters (job/status), detail page `/dashboard/recruitment/candidates/[id]`. Migration `0003`.
- **Recruitment Module (jobs)** — Job management + public job portal. HR page `/dashboard/recruitment/jobs` (list/search/filter, Add/Edit, Open/Close/Reopen, Delete DRAFT-only, Copy Link); public portal `/jobs/{slug}` (no auth, apply form — name/email/phone + optional CV). Status is **system-managed by backend**: complete required fields → `OPEN`, incomplete → `DRAFT`; `DRAFT` editable + hidden, auto-`OPEN` when completed, public only `OPEN` (excludes expired close_date); frontend cannot force status. RBAC `RECRUITMENT_ADMIN_ROLES` = ADMIN/HR_STAFF/HR_LEAD; audit via existing `log_event`.
- **Reimbursement Module (`apps.reimbursement`)** — Employee expense claims end-to-end. Configurable `ReimbursementCategory` (some require attachment), `Reimbursement` workflow (DRAFT/PENDING/APPROVED/REJECTED/PAID/CANCELLED) with submit/approve/reject/mark_paid/cancel actions, Supabase Storage attachments (signed download URLs), in-app `ReimbursementNotification`, RBAC (`REIMBURSEMENT_ADMIN_ROLES` = ADMIN/HR_STAFF/HR_LEAD), `seed_reimbursement_categories` command. HR page `/dashboard/reimbursements`; employee self-service `/dashboard/employee/reimbursement` (+ `/new` form: create → upload → submit). 20 tests.
- **Centralized auth session expiry** — 401/403 from `/api/auth/me/` or any API call triggers session clear + redirect to `/login` with return URL preserved. Implemented centrally in `auth-client.ts`, `api-client.ts`, `AuthProvider`, and `ProtectedRoute`. No per-page logic needed. See `src/lib/session-events.ts`.
- **Employee & Contract Lifecycle** — Employee CRUD, Department & Position masters, contract management (PKWT/PKWTT, system-managed status DRAFT/ACTIVE/EXPIRED/TERMINATED/RENEWED), employment history, and employee documents stored in Supabase Storage (signed download URLs).
- **Leave Module (`apps.leaves`)** — Configurable `LeaveType`, annual `LeaveBalance` tracking, `LeaveRequest` workflow (DRAFT/PENDING/APPROVED/REJECTED/CANCELLED with idempotent quota deduction and attachment support).
- **Employee Self-Service (`/dashboard/employee`)** — Role-restricted employee portal for viewing profile, submitting/tracking leave & reimbursement requests, and reviewing active contracts.
- **Extended Audit Log (`apps.audit`)** — Granular audit tracking (CREATE/UPDATE/DELETE/APPROVE/REJECT/ACTIVATE/TERMINATE/RENEW/UPLOAD/DOWNLOAD) with before/after diffs, sensitive field redaction (NIK/NPWP/BPJS/bank), and audit trail UI at `/dashboard/settings/audit-log`.
- **Production & Server Optimization** — Live on VPS (`43.154.128.239`) under `https://hris.feraco.co.id` (with redirect from `hris.agentlab.my.id`) with Nginx reverse proxy & Let's Encrypt SSL; connected to Supabase PostgreSQL (SG region). Server RAM optimized by removing unused legacy containers (~500 MB RAM / ~400 MB Swap freed). Full operational guide documented in `production.md`.
- **Validation** — Backend `check` & 34 recruitment tests pass; Frontend `tsc`, `oxlint`, and `next build` clean.