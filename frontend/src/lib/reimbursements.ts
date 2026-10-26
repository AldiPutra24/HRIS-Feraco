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
  bank_name: string;
  bank_account_name: string;
  bank_account_number: string;
  contact_email: string;
  attachment_name: string;
  /** Link alternative to the uploaded file (one of the two is used). */
  attachment_link: string;
  attachment_url: string | null;
  status: string;
  status_display: string;
  amount_set_by: number | null;
  amount_set_by_name: string | null;
  amount_set_at: string | null;
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
  /** Caller may approve/reject this request at the final stage now. */
  can_final_approve: boolean;
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

/** Semi-hierarchical approval statuses (labels follow the backend). */
export const REIMBURSEMENT_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  PENDING: 'Pending HR Staff',
  WAITING_HR_LEAD: 'Waiting HR Lead',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  PAID: 'Paid',
  CANCELLED: 'Cancelled'
};

/** Display label of a reimbursement status. */
export function reimbursementStatusLabel(r: Pick<Reimbursement, 'status'>): string {
  return REIMBURSEMENT_STATUS_LABELS[r.status] ?? r.status;
}

export type ReimbursementSummary = {
  counts: Record<string, number>;
  total: number;
  paid_amount: number | string;
  /** PAID within the current month (paid_at, local time). */
  paid_this_month?: { count: number; amount: number | string };
};

/** Live status counts from the backend (`mine` = caller's own records only). */
export function getReimbursementSummary(mine = true): Promise<ReimbursementSummary> {
  return request<ReimbursementSummary>(`/summary/${mine ? '?mine=1' : ''}`, { cache: 'no-store' });
}

/**
 * Download the reimbursement XLSX. The backend applies the user's scope (HR:
 * all, others: own) plus the given list filters; the file name comes from
 * the server (reimbursement-YYYY-MM-DD.xlsx).
 */
export async function exportReimbursementsXlsx(params: Record<string, string> = {}): Promise<void> {
  const qs = new URLSearchParams(params);
  const res = await fetch(`${BASE}/export/${qs.size ? `?${qs}` : ''}`, { credentials: 'include', cache: 'no-store' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(extractError(data) || `Export gagal (HTTP ${res.status}).`);
  }
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = disposition.match(/filename="?([^";]+)"?/);
  const filename = match?.[1] ?? `reimbursement-${new Date().toISOString().slice(0, 10)}.xlsx`;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function getReimbursement(id: number): Promise<Reimbursement> {
  return request<Reimbursement>(`/${id}/`, { cache: 'no-store' });
}

/** Page size of the reimbursement lists (backend default, max 100). */
export const REIMBURSEMENT_PAGE_SIZE = 20;

export type ReimbursementPage = { count: number; results: Reimbursement[] };

/** One page of reimbursements (`page`, `mine=1`, filters as params). */
export function listReimbursements(params?: Record<string, string>): Promise<ReimbursementPage> {
  const qs = params ? `?${new URLSearchParams(params)}` : '';
  return request<Reimbursement[] | ReimbursementPage>(`/${qs}`).then((data) =>
    Array.isArray(data) ? { count: data.length, results: data } : { count: data.count ?? 0, results: data.results ?? [] }
  );
}

export function createReimbursement(data: {
  category: number;
  project_category: string;
  project_category_other?: string;
  transaction_date: string;
  amount: number;
  description: string;
  bank_name: string;
  bank_account_name: string;
  bank_account_number: string;
  contact_email: string;
  attachment_link?: string;
}): Promise<Reimbursement> {
  return request<Reimbursement>('/', { method: 'POST', body: JSON.stringify(data) });
}

/** Layer 1 — HR Staff sets Nominal Disetujui (PENDING -> WAITING_HR_LEAD). */
export function reviewReimbursement(id: number, approved_amount: number): Promise<Reimbursement> {
  return request<Reimbursement>(`/${id}/review/`, {
    method: 'POST',
    body: JSON.stringify({ approved_amount })
  });
}

export function submitReimbursement(id: number): Promise<Reimbursement> {
  return request<Reimbursement>(`/${id}/submit/`, { method: 'POST' });
}

/** Layer 2 — HR Lead (GM for an HR Lead's own request) approves payment of the reviewed amount. */
export function approveReimbursement(id: number): Promise<Reimbursement> {
  return request<Reimbursement>(`/${id}/approve/`, { method: 'POST' });
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
