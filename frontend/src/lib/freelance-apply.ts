import { AUTH_API_BASE } from '@/lib/auth/auth-config';

const BASE = `${AUTH_API_BASE}/api/recruitment`;

export type FreelanceApplyForm = {
  id: number;
  title: string;
  slug: string;
  description: string;
  skills: number[];
  skill_details: { id: number; name: string; category: string | null }[];
  is_active: boolean;
  applications_count: number;
  public_url: string;
  created_at: string;
  updated_at: string;
};

export type FreelanceApplyFormInput = {
  title: string;
  description: string;
  skills: number[];
  is_active: boolean;
};

export type FormApplicant = {
  id: number;
  full_name: string;
  email: string;
  phone: string;
  skill_id: number;
  skill_name: string;
  submitted_at: string;
  status: string;
  cv_name: string | null;
  cv_url: string | null;
};

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function extractError(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (typeof d.detail === 'string') return d.detail;
  for (const key of Object.keys(d)) {
    const v = d[key];
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) {
      const first = v.find((x) => typeof x === 'string');
      if (first) return first;
    }
  }
  return null;
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
    throw new Error(extractError(data) || `API error ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ---- HR dashboard ----

export function listApplyForms(): Promise<FreelanceApplyForm[]> {
  return request<FreelanceApplyForm[]>('/freelance-apply-forms/');
}

export function createApplyForm(data: FreelanceApplyFormInput): Promise<FreelanceApplyForm> {
  return request<FreelanceApplyForm>('/freelance-apply-forms/', { method: 'POST', body: JSON.stringify(data) });
}

export function updateApplyForm(id: number, data: Partial<FreelanceApplyFormInput>): Promise<FreelanceApplyForm> {
  return request<FreelanceApplyForm>(`/freelance-apply-forms/${id}/`, { method: 'PATCH', body: JSON.stringify(data) });
}

export function deleteApplyForm(id: number): Promise<void> {
  return request<void>(`/freelance-apply-forms/${id}/`, { method: 'DELETE' });
}

export function listFormApplicants(id: number, skillId?: number): Promise<FormApplicant[]> {
  const q = skillId ? `?skill_id=${skillId}` : '';
  return request<FormApplicant[]>(`/freelance-apply-forms/${id}/applicants/${q}`);
}
