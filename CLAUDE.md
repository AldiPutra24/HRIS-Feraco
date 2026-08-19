# CLAUDE.md

HRIS Feraco — monorepo: `frontend/` (Next.js 16 + shadcn/ui) + `backend/` (Django + DRF + PostgreSQL).

## Key References

- **[AGENTS.md](./AGENTS.md)** — full architecture, tech stack, conventions, commands
- **[README.md](./README.md)** — overview + quickstart
- **[docs/deployment.md](./docs/deployment.md)** — Docker Compose + production env

## Critical Conventions

- **Auth** — Django session/cookie auth (no Clerk). Frontend calls `/api/auth/*` with `credentials: 'include'` + `X-CSRFToken` via `src/lib/auth/auth-client.ts`; `AuthProvider`/`useAuth()` state; `ProtectedRoute` guards `/dashboard`.
- **Backend structure** — Django apps under `apps/`: `accounts` (User/Role/Permission + auth endpoints), `personnel` (Personnel/Employee/Freelancer/Department/Position), `audit` (AuditLog + `services.log_event`).
- **RBAC** — roles `ADMIN/HR_STAFF/HR_LEAD/EMPLOYEE/MANAGEMENT`; nav filtering client-side in `use-nav.ts` is UI-only, real checks server-side.
- **Frontend layout** — routes in `app/`, reusable UI in `components/`, business module UI in `features/`, helpers in `lib/`, shared types in `types/`.
- **Icons** — only import from `@/components/icons`, never from `@tabler/icons-react` directly.
- **`cn()`** — merge classNames with `@/lib/utils`.
- **Server components by default** — `'use client'` only when needed.
- **Formatting** — single quotes, JSX single quotes, no trailing comma, 2-space indent.