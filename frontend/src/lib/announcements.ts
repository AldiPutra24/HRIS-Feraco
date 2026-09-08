import { AUTH_API_BASE } from '@/lib/auth/auth-config';

const BASE = `${AUTH_API_BASE}/api/announcements`;

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
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

export type Announcement = {
  id: number;
  title: string;
  body: string;
  created_by: number | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  status: 'ACTIVE' | 'INACTIVE';
  use_end_date: boolean;
  end_date: string | null;
};

export function listAnnouncements(): Promise<Announcement[]> {
  return request<{ results: Announcement[] }>('/').then((d) => d.results ?? []);
}

export function createAnnouncement(input: {
  title: string;
  body: string;
  status?: 'ACTIVE' | 'INACTIVE';
  use_end_date?: boolean;
  end_date?: string | null;
}): Promise<Announcement> {
  return request<Announcement>('/', { method: 'POST', body: JSON.stringify(input) });
}

export function updateAnnouncement(
  id: number,
  input: {
    title?: string;
    body?: string;
    status?: 'ACTIVE' | 'INACTIVE';
    use_end_date?: boolean;
    end_date?: string | null;
  }
): Promise<Announcement> {
  return request<Announcement>(`/${id}/`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function deleteAnnouncement(id: number): Promise<void> {
  return request<void>(`/${id}/`, { method: 'DELETE' });
}
