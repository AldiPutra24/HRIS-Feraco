import { AUTH_API_BASE } from '@/lib/auth/auth-config';

const BASE = `${AUTH_API_BASE}/api/recruitment`;

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

export type Job = {
  id: number;
  title: string;
  slug: string;
  department: number | null;
  department_name: string;
  position: number | null;
  position_name: string;
  description: string;
  requirements: string;
  employment_type: string;
  location: string;
  open_date: string;
  close_date: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  applications_count: number;
};

export type PublicJob = {
  id: number;
  title: string;
  slug: string;
  department_name: string;
  position_name: string;
  description: string;
  requirements: string;
  employment_type: string;
  location: string;
  open_date: string;
  close_date: string | null;
};

export type CandidateStatusHistory = {
  id: number;
  from_status: string;
  to_status: string;
  changed_by_name: string | null;
  changed_at: string;
  note: string;
};

export type Candidate = {
  id: number;
  job: number;
  job_title: string;
  full_name: string;
  email: string;
  phone: string;
  cv_name: string;
  cv_url: string | null;
  source: string;
  status: string;
  next_statuses: string[];
  status_history: CandidateStatusHistory[];
  applied_at: string;
  created_at: string;
};

type Page<T> = { results: T[]; count: number };

function unwrapList<T>(data: T[] | Page<T>): T[] {
  if (Array.isArray(data)) return data;
  return data.results ?? [];
}

export function listJobs(params: Record<string, string> = {}): Promise<Job[]> {
  const qs = new URLSearchParams(params).toString();
  return request<Job[]>(`/jobs/${qs ? `?${qs}` : ''}`).then(unwrapList);
}

export function getJob(id: number): Promise<Job> {
  return request<Job>(`/jobs/${id}/`);
}

export type JobInput = {
  title: string;
  department: number | null;
  position: number | null;
  description: string;
  requirements: string;
  employment_type: string;
  location: string;
  open_date: string;
  close_date: string | null;
};

export function createJob(input: JobInput): Promise<Job> {
  return request<Job>('/jobs/', { method: 'POST', body: JSON.stringify(input) });
}

export function updateJob(id: number, input: JobInput): Promise<Job> {
  return request<Job>(`/jobs/${id}/`, { method: 'PUT', body: JSON.stringify(input) });
}

export function deleteJob(id: number): Promise<void> {
  return request<void>(`/jobs/${id}/`, { method: 'DELETE' });
}

export function hardDeleteJob(id: number): Promise<void> {
  return request<void>(`/jobs/${id}/hard-delete/`, { method: 'DELETE' });
}

export function openJob(id: number): Promise<Job> {
  return request<Job>(`/jobs/${id}/open/`, { method: 'POST' });
}

export function closeJob(id: number): Promise<Job> {
  return request<Job>(`/jobs/${id}/close/`, { method: 'POST' });
}

export function reopenJob(id: number): Promise<Job> {
  return request<Job>(`/jobs/${id}/reopen/`, { method: 'POST' });
}

export function listCandidates(params: Record<string, string> = {}): Promise<Candidate[]> {
  const qs = new URLSearchParams(params).toString();
  return request<Candidate[]>(`/candidates/${qs ? `?${qs}` : ''}`).then(unwrapList);
}

export type ApplyInput = {
  job: number;
  full_name: string;
  email: string;
  phone: string;
  source?: string;
  cv?: File | null;
};

export function applyJob(input: ApplyInput): Promise<Candidate> {
  const body =
    input.cv instanceof File
      ? (() => {
          const fd = new FormData();
          fd.append('job', String(input.job));
          fd.append('full_name', input.full_name);
          fd.append('email', input.email);
          fd.append('phone', input.phone ?? '');
          if (input.source) fd.append('source', input.source);
          fd.append('cv', input.cv);
          return fd;
        })()
      : JSON.stringify({ ...input, source: input.source ?? 'PORTAL' });
  return request<Candidate>('/candidates/', {
    method: 'POST',
    body
  });
}

export function getCandidate(id: number): Promise<Candidate> {
  return request<Candidate>(`/candidates/${id}/`);
}

export function deleteCandidate(id: number): Promise<void> {
  return request<void>(`/candidates/${id}/`, { method: 'DELETE' });
}

export function hardDeleteCandidate(id: number): Promise<void> {
  return request<void>(`/candidates/${id}/hard-delete/`, { method: 'DELETE' });
}

export function getCandidateCv(id: number): Promise<{ url: string; name: string }> {
  return request<{ url: string; name: string }>(`/candidates/${id}/cv/`);
}

export function transitionCandidate(
  id: number,
  status: string,
  note = ''
): Promise<Candidate> {
  return request<Candidate>(`/candidates/${id}/transition/`, {
    method: 'POST',
    body: JSON.stringify({ status, note })
  });
}

export function listPublicJobs(): Promise<PublicJob[]> {
  return request<PublicJob[]>('/public/jobs/');
}

export function getPublicJob(slug: string): Promise<PublicJob> {
  return request<PublicJob>(`/public/jobs/${slug}/`);
}
