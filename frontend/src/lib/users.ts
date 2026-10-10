import { AUTH_API_BASE } from '@/lib/auth/auth-config';

const BASE = `${AUTH_API_BASE}/api`;

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('Content-Type', 'application/json');
  const csrf = getCookie('csrftoken');
  const method = (init.method ?? 'GET').toUpperCase();
  if (csrf && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) headers.set('X-CSRFToken', csrf);
  const res = await fetch(`${BASE}${path}`, { ...init, headers, credentials: 'include' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const msg = typeof data.detail === 'string' ? data.detail : JSON.stringify(data);
    throw new Error(msg || `API error ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export type Role = {
  id: number;
  key: string;
  name: string;
  user_count?: number;
};

export type AdminUser = {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  role: number | null;
  role_key: string | null;
  is_active: boolean;
  is_staff: boolean;
  employee_id: number | null;
  employee_name: string | null;
  // Session presence (read-only): from login + heartbeat, not is_active.
  last_seen_at: string | null;
  is_online: boolean;
  last_seen_seconds: number | null;
};

// Same window as the backend (apps/accounts/presence.py ONLINE_WINDOW).
export const ONLINE_WINDOW_SECONDS = 120;

/** "Baru saja", "30 detik lalu", "5 menit lalu", ... or "Belum pernah aktif". */
export function lastSeenLabel(seconds: number | null): string {
  if (seconds === null) return 'Belum pernah aktif';
  if (seconds < 10) return 'Baru saja';
  if (seconds < 60) return `${seconds} detik lalu`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} menit lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} hari lalu`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} bulan lalu`;
  return `${Math.floor(months / 12)} tahun lalu`;
}

export function listRoles(): Promise<Role[]> {
  return request<Role[]>('/auth/roles/');
}

export function listUsers(): Promise<AdminUser[]> {
  return request<AdminUser[]>('/auth/users/');
}

export function createUser(data: Partial<AdminUser> & { password?: string; employee?: number | null }): Promise<AdminUser> {
  return request<AdminUser>('/auth/users/', { method: 'POST', body: JSON.stringify(data) });
}

export function updateUser(id: number, data: Partial<AdminUser> & { password?: string; employee?: number | null }): Promise<AdminUser> {
  return request<AdminUser>(`/auth/users/${id}/`, { method: 'PATCH', body: JSON.stringify(data) });
}

export function deleteUser(id: number, hard = false): Promise<void> {
  return request<void>(`/auth/users/${id}/${hard ? 'hard-delete/' : ''}`, { method: 'DELETE' });
}
