import { AUTH_API_BASE } from '@/lib/auth/auth-config';

const BASE = `${AUTH_API_BASE}/api/reimbursements`;

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

export type ReimbursementCategory = {
  id: number;
  name: string;
  code: string;
  is_active: boolean;
  requires_attachment: boolean;
  description: string;
};

export type Reimbursement = {
  id: number;
  employee: number;
  employee_name: string;
  category: number;
  category_name: string;
  transaction_date: string;
  amount: number;
  approved_amount: number | null;
  project_category: string;
  project_category_other: string;
  description: string;
  attachment_name: string;
  attachment_url: string | null;
  status: string;
  submitted_at: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  paid_at: string | null;
  reviewer: number | null;
  reviewer_name: string;
  rejection_reason: string;
  payment_reference: string;
  payment_proof_name: string;
  payment_proof_url: string | null;
  created_at: string;
  updated_at: string;
};

export type ReimbursementNotification = {
  id: number;
  reimbursement: number;
  message: string;
  is_read: boolean;
  created_at: string;
};

// ponytail: unwrap DRF paginated {count, results}; drop when pagination_class=None
function unwrapList<T>(data: T[] | { results?: T[] }): T[] {
  return Array.isArray(data) ? data : (data.results ?? []);
}

export function listReimbursementCategories(): Promise<ReimbursementCategory[]> {
  return request<ReimbursementCategory[]>('/categories/').then(unwrapList);
}

export function listReimbursements(params?: Record<string, string>): Promise<Reimbursement[]> {
  const qs = params ? `?${new URLSearchParams(params)}` : '';
  return request<Reimbursement[]>(`/${qs}`).then(unwrapList);
}

export function createReimbursement(data: {
  category: number;
  project_category: string;
  project_category_other?: string;
  transaction_date: string;
  amount: number;
  description: string;
}): Promise<Reimbursement> {
  return request<Reimbursement>('/', { method: 'POST', body: JSON.stringify(data) });
}

export function submitReimbursement(id: number): Promise<Reimbursement> {
  return request<Reimbursement>(`/${id}/submit/`, { method: 'POST' });
}

export function approveReimbursement(id: number, approved_amount: number): Promise<Reimbursement> {
  return request<Reimbursement>(`/${id}/approve/`, {
    method: 'POST',
    body: JSON.stringify({ approved_amount }),
  });
}

export function rejectReimbursement(id: number, rejection_reason: string): Promise<Reimbursement> {
  return request<Reimbursement>(`/${id}/reject/`, {
    method: 'POST',
    body: JSON.stringify({ rejection_reason }),
  });
}

export function markReimbursementPaid(
  id: number,
  payment_reference: string,
  file?: File
): Promise<Reimbursement> {
  if (file) {
    const fd = new FormData();
    fd.append('payment_reference', payment_reference);
    fd.append('file', file);
    return request<Reimbursement>(`/${id}/mark_paid/`, { method: 'POST', body: fd });
  }
  return request<Reimbursement>(`/${id}/mark_paid/`, {
    method: 'POST',
    body: JSON.stringify({ payment_reference }),
  });
}

export function cancelReimbursement(id: number): Promise<Reimbursement> {
  return request<Reimbursement>(`/${id}/cancel/`, { method: 'POST' });
}

export function deleteReimbursement(id: number): Promise<void> {
  return request<void>(`/${id}/`, { method: 'DELETE' });
}

export function uploadReimbursementAttachment(id: number, file: File): Promise<Reimbursement> {
  const fd = new FormData();
  fd.append('file', file);
  return request<Reimbursement>(`/${id}/attachment/`, { method: 'POST', body: fd });
}

export function listReimbursementNotifications(): Promise<ReimbursementNotification[]> {
  return request<ReimbursementNotification[]>('/notifications/');
}
