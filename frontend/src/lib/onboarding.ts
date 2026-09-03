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
  completed_by: number | null;
  completed_by_name: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  status_history: OnboardingStatusHistory[];
  employee: number | null;
  employee_id: string | null;
  employee_name: string | null;
  employee_status: string | null;
  account_status: string | null;
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

export function completeOnboarding(id: number): Promise<Onboarding> {
  return request<Onboarding>(`/${id}/complete/`, { method: 'POST' });
}

// ── Tahap 2: OnboardingData ──────────────────────────────────────────

export type OnboardingData = {
  id: number;
  onboarding: number;
  full_name: string;
  nik: string;
  birth_place: string;
  birth_date: string | null;
  address: string;
  phone: string;
  personal_email: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  bank_account_number: string;
  bank_account_name: string;
  npwp: string;
  bpjs_kesehatan: string;
  bpjs_ketenagakerjaan: string;
  department: number | null;
  department_name: string | null;
  position: number | null;
  position_name: string | null;
  reporting_to: number | null;
  reporting_to_name: string | null;
  join_date: string | null;
  employment_type: string;
  probation_enabled: boolean;
  probation_start_date: string | null;
  probation_end_date: string | null;
};

export function getOnboardingData(id: number): Promise<OnboardingData> {
  return request<OnboardingData>(`/${id}/data/`);
}

export function updateOnboardingData(
  id: number,
  data: Partial<OnboardingData>
): Promise<OnboardingData> {
  return request<OnboardingData>(`/${id}/data/`, {
    method: 'PATCH',
    body: JSON.stringify(data)
  });
}

// ── Tahap 2: Checklist ───────────────────────────────────────────────

export type OnboardingChecklistItem = {
  id: number;
  onboarding: number;
  name: string;
  code: string;
  category: string;
  required: boolean;
  completed: boolean;
  notes: string;
  completed_at: string | null;
  completed_by: number | null;
  completed_by_name: string | null;
  ordering: number;
};

export function listChecklist(id: number): Promise<OnboardingChecklistItem[]> {
  return request<OnboardingChecklistItem[]>(`/${id}/checklist/`);
}

export function updateChecklistItem(
  onboardingId: number,
  itemId: number,
  data: Partial<Pick<OnboardingChecklistItem, 'completed' | 'notes'>>
): Promise<OnboardingChecklistItem> {
  return request<OnboardingChecklistItem>(`/${onboardingId}/checklist/${itemId}/`, {
    method: 'PATCH',
    body: JSON.stringify(data)
  });
}

// ── Tahap 2: Documents ───────────────────────────────────────────────

export type OnboardingDocument = {
  id: number;
  onboarding: number;
  document_type: string;
  document_type_label: string;
  status: string;
  status_label: string;
  original_name: string;
  mime_type: string;
  file_size: number;
  uploaded_by: number | null;
  uploaded_by_name: string | null;
  reviewed_by: number | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  rejection_reason: string;
  notes: string;
  uploaded_at: string;
  updated_at: string;
};

export function listDocuments(id: number): Promise<OnboardingDocument[]> {
  return request<OnboardingDocument[]>(`/${id}/documents/`);
}

export function uploadDocument(
  onboardingId: number,
  file: File,
  documentType: string
): Promise<OnboardingDocument> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('document_type', documentType);
  const csrf = getCookie('csrftoken');
  return fetch(`${BASE}/${onboardingId}/documents/`, {
    method: 'POST',
    body: formData,
    credentials: 'include',
    headers: csrf ? { 'X-CSRFToken': csrf } : {}
  }).then(async (res) => {
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(extractError(data) || `Upload gagal (${res.status})`);
    }
    return res.json();
  });
}

export function updateDocument(
  onboardingId: number,
  docId: number,
  data: Partial<{ status: string; rejection_reason: string }>
): Promise<OnboardingDocument> {
  return request<OnboardingDocument>(`/${onboardingId}/documents/${docId}/`, {
    method: 'PATCH',
    body: JSON.stringify(data)
  });
}

export function deleteDocument(onboardingId: number, docId: number): Promise<void> {
  return request<void>(`/${onboardingId}/documents/${docId}/`, { method: 'DELETE' });
}

export function downloadDocument(onboardingId: number, docId: number): Promise<Blob> {
  const csrf = getCookie('csrftoken');
  return fetch(`${BASE}/${onboardingId}/documents/${docId}/download/`, {
    credentials: 'include',
    headers: csrf ? { 'X-CSRFToken': csrf } : {}
  }).then(async (res) => {
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(extractError(data) || `Download gagal (${res.status})`);
    }
    return res.blob();
  });
}

// ── Tahap 2: Readiness ───────────────────────────────────────────────

export type OnboardingReadiness = {
  status: string;
  ready: boolean;
  progress: number;
  errors: string[];
};

export function getReadiness(id: number): Promise<OnboardingReadiness> {
  return request<OnboardingReadiness>(`/${id}/readiness/`);
}
