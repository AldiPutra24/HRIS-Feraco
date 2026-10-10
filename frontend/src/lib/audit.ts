import { AUTH_API_BASE } from '@/lib/auth/auth-config';

const BASE = `${AUTH_API_BASE}/api`;

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/** First readable message from a DRF error body ({detail} or {field: [msg]}). */
function errorMessage(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const body = data as Record<string, unknown>;
  if (typeof body.detail === 'string') return body.detail;
  for (const value of Object.values(body)) {
    if (typeof value === 'string') return value;
    if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  }
  return '';
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const csrf = getCookie('csrftoken');
  const method = (init.method ?? 'GET').toUpperCase();
  if (csrf && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) headers.set('X-CSRFToken', csrf);
  const res = await fetch(`${BASE}${path}`, { ...init, headers, credentials: 'include' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(errorMessage(data) || `API error ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export type AuditEntry = {
  id: number;
  action: string;
  actor: string | null;
  module: string | null;
  entity_type: string | null;
  entity_id: number | null;
  object_repr: string | null;
  description: string;
  changes_before: Record<string, unknown>;
  changes_after: Record<string, unknown>;
  metadata: Record<string, unknown>;
  ip_address: string | null;
  user_agent: string;
  timestamp: string;
};

export type Page<T> = { count: number; next: string | null; previous: string | null; results: T[] };

// Fallback when /actions/ is unavailable. Values are lowercase, as stored.
export const AUDIT_ACTIONS = [
  'create', 'update', 'delete', 'approve', 'reject', 'activate',
  'terminate', 'renew', 'login', 'logout', 'upload', 'download'
];

/** Action values for the filter: known choices + custom actions recorded in the log. */
export function listAuditActions(): Promise<string[]> {
  return request<string[]>('/audit/audit-logs/actions/');
}

/** Display label: 'payroll_period_approved' -> 'PAYROLL PERIOD APPROVED'. */
export function auditActionLabel(action: string): string {
  return action.replace(/_/g, ' ').toUpperCase();
}

export function listAuditLogs(params: Record<string, string | undefined> = {}): Promise<Page<AuditEntry>> {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  return request<Page<AuditEntry>>(`/audit/audit-logs/?${q.toString()}`);
}

export function deleteAuditLog(id: number, hard = false): Promise<void> {
  return request<void>(`/audit/audit-logs/${id}/${hard ? 'hard-delete/' : ''}`, { method: 'DELETE' });
}

export function clearAllAuditLogs(): Promise<{ deleted: number }> {
  return request<{ deleted: number }>('/audit/audit-logs/clear-all/', { method: 'DELETE' });
}
