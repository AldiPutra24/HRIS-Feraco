import { AUTH_ENDPOINTS } from './auth-config';
import type { AuthError, AuthUser, LoginCredentials } from './auth-types';

function buildError(message: string, code?: string): AuthError {
  return { message, code };
}

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

// Django session auth needs the CSRF token read from the cookie and echoed as a header.
function authFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('Content-Type', 'application/json');

  const csrf = getCookie('csrftoken');
  const method = (init.method ?? 'GET').toUpperCase();
  if (csrf && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    headers.set('X-CSRFToken', csrf);
  }

  return fetch(url, { ...init, headers, credentials: 'include' });
}

function toUser(data: Record<string, unknown>): AuthUser {
  const name = [data.first_name, data.last_name].filter(Boolean).join(' ').trim();
  const rawRole = typeof data.role === 'string' ? data.role.toLowerCase() : null;
  return {
    id: Number(data.id),
    name: name || String(data.username ?? data.email ?? ''),
    email: String(data.email ?? ''),
    role: (rawRole as AuthUser['role']) ?? null
  };
}

export async function login(credentials: LoginCredentials): Promise<AuthUser> {
  const res = await authFetch(AUTH_ENDPOINTS.login, {
    method: 'POST',
    body: JSON.stringify({ email: credentials.email, password: credentials.password })
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const message = Array.isArray(data.detail)
      ? data.detail[0]
      : data.detail || data.message || 'Invalid credentials.';
    throw buildError(String(message), 'invalid_credentials');
  }

  return toUser(await res.json());
}

export async function logout(): Promise<void> {
  await authFetch(AUTH_ENDPOINTS.logout, { method: 'POST' }).catch(() => undefined);
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  try {
    const res = await authFetch(AUTH_ENDPOINTS.me);
    if (!res.ok) return null;
    return toUser(await res.json());
  } catch {
    return null;
  }
}
