import { AUTH_API_BASE } from '@/lib/auth/auth-config';

const BASE = `${AUTH_API_BASE}/api/onboarding`;

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
  if (init.body) headers.set('Content-Type', 'application/json');
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

export type OnboardingStatusHistory = {
  id: number;
  from_status: string;
  to_status: string;
  changed_by_name: string | null;
  changed_at: string;
  note: string;
};
export type Onboarding = {
  id: number;
  candidate: number;
  candidate_name: string;
  candidate_email: string;
  candidate_status: string;
  job_title: string;
  department_name: string | null;
  position_name: string | null;
  status: string;
  next_statuses: string[];
  target_join_date: string | null;
  notes: string;
  created_by: number | null;
  created_by_name: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  status_history: OnboardingStatusHistory[];
};

export const ONBOARDING_STATUSES = [
  'PENDING',
  'IN_PROGRESS',
  'DOCUMENT_REVIEW',
  'READY',
  'COMPLETED',
  'CANCELLED'
] as const;

export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];

export function onboardingStatusLabel(s: string): string {
  const map: Record<string, string> = {
    PENDING: 'Pending',
    IN_PROGRESS: 'In Progress',
    DOCUMENT_REVIEW: 'Document Review',
    READY: 'Ready',
    COMPLETED: 'Completed',
    CANCELLED: 'Cancelled'
  };
  return map[s] ?? s;
}

export function onboardingStatusVariant(s: string): 'default' | 'secondary' | 'outline' {
  if (s === 'CANCELLED') return 'outline';
  if (s === 'COMPLETED') return 'secondary';
  return 'default';
}

type Page<T> = { results: T[]; count: number };

function unwrapList<T>(data: T[] | Page<T>): T[] {
  if (Array.isArray(data)) return data;
  return data.results ?? [];
}

export function listOnboarding(params: Record<string, string> = {}): Promise<Onboarding[]> {
  const qs = new URLSearchParams(params).toString();
  return request<Onboarding[]>(`/${qs ? `?${qs}` : ''}`).then(unwrapList);
}

export function getOnboarding(id: number): Promise<Onboarding> {
  return request<Onboarding>(`/${id}/`);
}

export type OnboardingInput = {
  candidate: number;
  target_join_date?: string | null;
  notes?: string;
};

export function createOnboarding(input: OnboardingInput): Promise<Onboarding> {
  return request<Onboarding>('/', { method: 'POST', body: JSON.stringify(input) });
}

export function updateOnboarding(id: number, input: Partial<OnboardingInput>): Promise<Onboarding> {
  return request<Onboarding>(`/${id}/`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function transitionOnboarding(
  id: number,
  status: string,
  note = ''
): Promise<Onboarding> {
  return request<Onboarding>(`/${id}/transition/`, {
    method: 'POST',
    body: JSON.stringify({ status, note })
  });
}
