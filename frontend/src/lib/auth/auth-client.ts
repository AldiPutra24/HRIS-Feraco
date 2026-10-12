import { emitSessionExpired } from '@/lib/session-events';
import { AUTH_API_BASE, AUTH_ENDPOINTS } from './auth-config';
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
    role: (rawRole as AuthUser['role']) ?? null,
    photoUrl: typeof data.photo_url === 'string' && data.photo_url ? data.photo_url : null
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

/**
 * Session presence ping (Settings -> Users "Online / Terakhir aktif").
 * Best-effort: never throws and never triggers session-expired handling —
 * the regular auth flow stays the single source of truth for logout.
 */
export async function sendHeartbeat(): Promise<void> {
  await authFetch(AUTH_ENDPOINTS.heartbeat, { method: 'POST' }).catch(() => undefined);
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  try {
    const res = await authFetch(AUTH_ENDPOINTS.me);
    if (res.status === 401 || res.status === 403) {
      emitSessionExpired();
      return null;
    }
    if (!res.ok) return null;
    return toUser(await res.json());
  } catch {
    return null;
  }
}

const ACCOUNT_FIELD_LABELS: Record<string, string> = {
  username: 'Username',
  email: 'Email',
  first_name: 'Nama',
  last_name: 'Nama',
  password: 'Password baru',
  current_password: 'Password saat ini'
};

/** First readable message from a DRF error body: "Label: pesan". */
function accountErrorMessage(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const body = payload as Record<string, unknown>;
  if (typeof body.detail === 'string') return body.detail;
  for (const [field, value] of Object.entries(body)) {
    const msg = Array.isArray(value) ? value[0] : value;
    if (typeof msg === 'string') {
      const label = ACCOUNT_FIELD_LABELS[field];
      return label ? `${label}: ${msg}` : msg;
    }
  }
  return '';
}

export type SelfAccount = {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
};

/** Current account fields (real username — AuthUser has no username). */
export async function getSelfAccount(): Promise<SelfAccount> {
  const res = await authFetch(`${AUTH_API_BASE}/api/auth/me/account/`);
  if (!res.ok) throw new Error('Gagal memuat data akun.');
  return res.json();
}

/**
 * PATCH own account. The response has no role, so callers must reload the
 * session user from /me/ (see AuthProvider.updateAccount) — never build the
 * AuthUser from this response (role would become null -> wrong menu).
 */
export async function updateSelfAccount(data: {
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  password?: string;
  current_password?: string;
}): Promise<SelfAccount> {
  const res = await authFetch(`${AUTH_API_BASE}/api/auth/me/account/`, {
    method: 'PATCH',
    body: JSON.stringify(data)
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(accountErrorMessage(payload) || `Gagal memperbarui akun (HTTP ${res.status}).`);
  }
  return res.json();
}
