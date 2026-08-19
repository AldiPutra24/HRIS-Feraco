# AGENTS.md - AI Coding Agent Reference

Essential information for AI coding agents working on this project: architecture, conventions, and commands.

---

## Project Overview

**HRIS Feraco** — internal Human Resource Information System, a monorepo with two services:

- **`frontend/`** — Next.js 16 (App Router), TypeScript, Tailwind CSS v4, shadcn/ui on Base UI
- **`backend/`** — Django + Django REST Framework, PostgreSQL, session/cookie auth, RBAC, audit log

No Clerk, no billing, no organizations. Authentication is Django session-based.

---

## Repository Structure

```
/
+-- frontend/              # Next.js 16 (App Router)
|   +-- src/
|   |   +-- app/           # routes (login, dashboard/*)
|   |   +-- components/    # reusable UI + layout (ui/, layout/, auth/, themes/, icons.tsx)
|   |   +-- features/      # business module UI (hris-dashboard/)
|   |   +-- lib/           # helpers (api-client, auth/, query-client, utils)
|   |   +-- hooks/         # custom hooks (use-nav, use-breadcrumbs, use-mobile, use-media-query)
|   |   +-- config/        # nav-config.ts
|   |   +-- constants/     # hris-mock-data.ts (dashboard demo data)
|   |   `-- types/         # hris.ts, index.ts
|   +-- package.json
|   `-- Dockerfile / Dockerfile.bun
+-- backend/               # Django
|   +-- config/            # settings.py, urls.py, wsgi/asgi
|   +-- apps/
|   |   +-- accounts/      # User, Role, Permission, auth endpoints, seed_roles
|   |   +-- personnel/     # Personnel/Employee/Freelancer/Department/Position
|   |   `-- audit/         # AuditLog + services.py
|   +-- manage.py
|   `-- requirements.txt
+-- docs/                  # deployment.md
+-- docker-compose.yml     # postgres + backend + frontend
+-- .env.example
`-- README.md
```

---

## Tech Stack

### Frontend

- Next.js 16 (App Router), React 19, TypeScript 5.7 (strict)
- Tailwind CSS v4 (`@import 'tailwindcss'`), PostCSS
- shadcn/ui on **Base UI** (`@base-ui/react`) primitives — NOT Radix
- Icons: `@tabler/icons-react`, centralized in `src/components/icons.tsx` (`Icons` object)
- `@tanstack/react-query` (QueryProvider, query-client singleton)
- `nuqs` (NuqsAdapter in root layout; URL search params)
- `next-themes` (single light/dark theme), `nextjs-toploader`
- `@sentry/nextjs` (instrumentation.ts, instrumentation-client.ts, global-error.tsx)
- Tooling: `oxlint` (lint), `oxfmt` (format), `tsc --noEmit` (typecheck), `next build` (turbopack)

### Backend

- Django 5.x, Django REST Framework 3.x
- PostgreSQL (`psycopg[binary]`); SQLite override via `DB_ENGINE=sqlite`
- `django-cors-headers` for CORS; Django session auth (server-side cookie)
- `gunicorn` for production

---

## Backend

### Apps

| App | Purpose |
| --- | --- |
| `apps/accounts` | Custom `User` (AUTH_USER_MODEL), `Role` (ADMIN/HR_STAFF/HR_LEAD/EMPLOYEE/MANAGEMENT) + `Permission` M2M; `login`/`logout`/`me` endpoints; `seed_roles` command |
| `apps/personnel` | `Personnel` (base) + `Employee` + `Freelancer` + `Department` + `Position` (models only, no API views yet) |
| `apps/audit` | `AuditLog` (login/logout/create/update/delete/permission_change/role_change) + `services.log_event()` |

### Auth & RBAC

- Session/cookie auth (`SessionAuthentication`), `IsAuthenticated` default permission.
- Login: `POST /api/auth/login` (email + password) sets the session cookie.
- Logout: `POST /api/auth/logout`.
- Current user: `GET /api/auth/me`.
- CSRF: frontend reads `csrftoken` cookie and echoes it as `X-CSRFToken` header.
- CORS: `CORS_ALLOWED_ORIGINS` + `CORS_ALLOW_CREDENTIALS=True`; `CSRF_TRUSTED_ORIGINS` must list the frontend origin.

### Environment

See `.env.example`. Key vars: `DJANGO_SECRET_KEY`, `DJANGO_DEBUG`, `POSTGRES_*`, `CORS_ALLOWED_ORIGINS`, `CSRF_TRUSTED_ORIGINS`, `DB_ENGINE` (default `postgres`, `sqlite` for local-only).

### Commands

```bash
cd backend
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
$env:DB_ENGINE='sqlite'
.\.venv\Scripts\python.exe manage.py migrate
.\.venv\Scripts\python.exe manage.py seed_roles   # roles + admin@feraco.id / password
.\.venv\Scripts\python.exe manage.py runserver
```

---

## Frontend

### Auth

- `src/lib/auth/auth-types.ts` — `AuthUser`, `AuthRole`, `LoginCredentials`, `AuthError`.
- `src/lib/auth/auth-config.ts` — `AUTH_API_BASE` (`NEXT_PUBLIC_API_URL` default `http://localhost:8000`) + endpoints.
- `src/lib/auth/auth-client.ts` — `login`/`logout`/`getCurrentUser`; fetch with `credentials: 'include'` + `X-CSRFToken`.
- `src/lib/auth/auth-provider.tsx` — `AuthProvider` + `useAuth()` context.
- `src/components/auth/protected-route.tsx` — guards `/dashboard`, redirects to `/login?returnUrl=...`.
- `src/components/auth/login-form.tsx` — email/password/remember/show-password.

`AuthUser` shape: `{ id: number; name: string; email: string; role: AuthRole | null }`.

### Roles

`AuthRole = 'admin' | 'hr_staff' | 'hr_lead' | 'employee' | 'management'`.

`src/hooks/use-nav.ts` filters nav items client-side by `user.role` (UI only). Real authorization must be enforced server-side in Django.

### Conventions

- **Icons** — import from `@/components/icons`, never from `@tabler/icons-react` directly. Add new icons to the `Icons` object.
- **Page headers** — pages under `/dashboard/*` use placeholder pages (`src/components/placeholder-page.tsx`). Overview page renders `features/hris-dashboard/` components.
- **`cn()`** — use `@/lib/utils` `cn()` for className merging.
- **API client** — `src/lib/api-client.ts` (`apiClient<T>`) is the fetch wrapper for backend calls; auth uses `src/lib/auth/auth-client.ts`.
- **Server components by default** — add `'use client'` only when using browser APIs or hooks.
- **Formatting** — single quotes, JSX single quotes, no trailing comma, 2-space indent.

---

## Commands

```bash
# Frontend (cd frontend)
npm install
npm run dev         # http://localhost:3000
npm run typecheck   # tsc --noEmit
npm run lint        # oxlint
npm run build       # next build

# Backend (cd backend, activate venv)
.\.venv\Scripts\python.exe manage.py check
.\.venv\Scripts\python.exe manage.py test
.\.venv\Scripts\python.exe manage.py makemigrations
.\.venv\Scripts\python.exe manage.py migrate
```

---

## Validation checklist

- Backend: `manage.py check` + `manage.py test`
- Frontend: `tsc --noEmit`, `oxlint`, `next build`

---

## Demo login

- Email: `admin@feraco.id` / Password: `password`