import { AUTH_API_BASE } from '@/lib/auth/auth-config';

const BASE = `${AUTH_API_BASE}/api/leaves`;

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

export type LeaveType = {
  id: number;
  name: string;
  code: string;
  kind: string;
  is_active: boolean;
  default_quota: number;
  requires_attachment: boolean;
  max_days_per_request: number | null;
  min_tenure_months: number | null;
  max_days_without_attachment: number;
  carry_forward_max: number;
  deducts_from: number | null;
  is_paid: boolean;
  description: string;
};

export type LeaveBalance = {
  id: number;
  employee: number;
  employee_name: string;
  leave_type: number;
  leave_type_name: string;
  year: number;
  allocated_days: number;
  used_days: number;
  remaining_days: number;
};

export type LeaveRequest = {
  id: number;
  employee: number;
  employee_name: string;
  leave_type: number;
  leave_type_name: string;
  leave_type_kind: string;
  start_date: string;
  end_date: string;
  total_days: number;
  reason: string;
  attachment_name: string;
  attachment_url: string | null;
  status: string;
  submitted_at: string;
  approved_at: string | null;
  rejected_at: string | null;
  approver: number | null;
  approver_name: string;
  rejection_reason: string;
  remaining_days: number;
  created_at: string;
  updated_at: string;
};

export type LeaveNotification = {
  id: number;
  leave_request: number;
  message: string;
  is_read: boolean;
  created_at: string;
};

export function listLeaveTypes(): Promise<LeaveType[]> {
  return request<LeaveType[]>('/types/');
}

// ponytail: unwrap DRF paginated {count, results}; drop when all leave endpoints set pagination_class=None
function unwrapList<T>(data: T[] | { results?: T[] }): T[] {
  return Array.isArray(data) ? data : (data.results ?? []);
}

export function listBalances(): Promise<LeaveBalance[]> {
  return request<LeaveBalance[]>('/balances/').then(unwrapList);
}

export function listLeaveRequests(params?: Record<string, string>): Promise<LeaveRequest[]> {
  const qs = params ? `?${new URLSearchParams(params)}` : '';
  return request<LeaveRequest[]>(`/requests/${qs}`).then(unwrapList);
}

export function createLeaveRequest(data: Record<string, unknown>): Promise<LeaveRequest> {
  return request<LeaveRequest>('/requests/', { method: 'POST', body: JSON.stringify(data) });
}

export function approveLeave(id: number): Promise<LeaveRequest> {
  return request<LeaveRequest>(`/requests/${id}/approve/`, { method: 'POST' });
}

export function rejectLeave(id: number, rejection_reason: string): Promise<LeaveRequest> {
  return request<LeaveRequest>(`/requests/${id}/reject/`, {
    method: 'POST',
    body: JSON.stringify({ rejection_reason }),
  });
}

export function cancelLeave(id: number): Promise<LeaveRequest> {
  return request<LeaveRequest>(`/requests/${id}/cancel/`, { method: 'POST' });
}

export function hardDeleteLeave(id: number): Promise<void> {
  return request<void>(`/requests/${id}/hard-delete/`, { method: 'DELETE' });
}

export function uploadLeaveAttachment(id: number, file: File): Promise<LeaveRequest> {
  const fd = new FormData();
  fd.append('file', file);
  return request<LeaveRequest>(`/requests/${id}/attachment/`, { method: 'POST', body: fd });
}

export function listLeaveNotifications(): Promise<LeaveNotification[]> {
  return request<LeaveNotification[]>('/requests/notifications/');
}
