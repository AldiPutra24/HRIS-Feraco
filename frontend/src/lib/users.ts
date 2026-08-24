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
};

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

export function deleteUser(id: number): Promise<void> {
  return request<void>(`/auth/users/${id}/`, { method: 'DELETE' });
}
