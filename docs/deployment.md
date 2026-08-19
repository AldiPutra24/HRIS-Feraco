# Deployment

## Docker Compose

```bash
docker compose up --build -d
```

- `postgres` - PostgreSQL 16, port 5432.
- `backend` - Django + gunicorn, port 8000 (runs migrate + seed on start).
- `frontend` - Next.js standalone, port 3000.

Set production values in `.env` (see `.env.example`): `DJANGO_SECRET_KEY`, `DJANGO_DEBUG=false`, `DJANGO_ALLOWED_HOSTS`, PostgreSQL credentials, `CORS_ALLOWED_ORIGINS`, `CSRF_TRUSTED_ORIGINS`.

## Frontend only (Vercel / static host)

Build with `NEXT_PUBLIC_API_URL` pointing at the deployed Django instance. Cookie-based auth requires the backend origin to be listed in `CORS_ALLOWED_ORIGINS` and `CSRF_TRUSTED_ORIGINS`, and frontend requests must use `credentials: 'include'` (already configured in `src/lib/auth/auth-client.ts`).