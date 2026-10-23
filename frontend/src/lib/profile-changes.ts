import { AUTH_API_BASE } from '@/lib/auth/auth-config';
import type { Employee } from '@/lib/employees';

const BASE = `${AUTH_API_BASE}/api`;

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/** First readable message of a DRF error body ({detail} or {field: [msg]}). */
function extractError(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (typeof d.detail === 'string') return d.detail;
  for (const v of Object.values(d)) {
    if (typeof v === 'string') return v;
    if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  }
  return null;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const csrf = getCookie('csrftoken');
  const method = (init.method ?? 'GET').toUpperCase();
  if (csrf && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) headers.set('X-CSRFToken', csrf);
  const res = await fetch(`${BASE}${path}`, { ...init, headers, credentials: 'include', cache: 'no-store' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(extractError(data) || `API error ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ── Field definitions (mirror backend apps/personnel/profile_changes.py) ──

/** Edited directly by the employee (no approval). */
export const SELF_EDIT_FIELDS = [
  { field: 'address', label: 'Alamat' },
  { field: 'phone', label: 'Nomor Telepon' },
  { field: 'personal_email', label: 'Email Pribadi' },
  { field: 'emergency_contact_name', label: 'Kontak Darurat' },
  { field: 'emergency_contact_phone', label: 'Nomor Kontak Darurat' }
] as const;

export type SelfEditField = (typeof SELF_EDIT_FIELDS)[number]['field'];

export type Option = { value: string; label: string };

export const RELIGION_OPTIONS: Option[] = [
  { value: 'ISLAM', label: 'Islam' },
  { value: 'PROTESTAN', label: 'Protestan' },
  { value: 'KATOLIK', label: 'Katolik' },
  { value: 'HINDU', label: 'Hindu' },
  { value: 'BUDDHA', label: 'Buddha' },
  { value: 'KONGHUCU', label: 'Konghucu' }
];
export const GENDER_OPTIONS: Option[] = [
  { value: 'MALE', label: 'Laki-laki' },
  { value: 'FEMALE', label: 'Perempuan' }
];
export const MARITAL_OPTIONS: Option[] = [
  { value: 'SINGLE', label: 'Belum Menikah' },
  { value: 'MARRIED', label: 'Menikah' },
  { value: 'DIVORCED', label: 'Cerai' },
  { value: 'WIDOWED', label: 'Janda/Duda' }
];

export type RequestFieldDef = {
  field: string;
  label: string;
  type?: 'text' | 'date' | 'select';
  options?: Option[];
  /** Supporting document required when this field is requested. */
  needsAttachment: boolean;
};

/** Changed only through a request approved by HR Staff / HR Lead / Admin. */
export const REQUEST_GROUPS: { title: string; hint: string; fields: RequestFieldDef[] }[] = [
  {
    title: 'Identitas',
    hint: 'Lampirkan KTP',
    fields: [
      { field: 'full_name', label: 'Nama Lengkap', needsAttachment: true },
      { field: 'nik', label: 'NIK', needsAttachment: true },
      { field: 'birth_place', label: 'Tempat Lahir', needsAttachment: true },
      { field: 'birth_date', label: 'Tanggal Lahir', type: 'date', needsAttachment: true }
    ]
  },
  {
    title: 'Rekening Bank',
    hint: 'Lampirkan foto buku tabungan',
    fields: [
      { field: 'bank_account_number', label: 'Nomor Rekening', needsAttachment: true },
      { field: 'bank_account_name', label: 'Nama Pemilik Rekening', needsAttachment: true }
    ]
  },
  {
    title: 'Pajak & BPJS',
    hint: 'Lampirkan kartu NPWP / BPJS',
    fields: [
      { field: 'npwp', label: 'NPWP', needsAttachment: true },
      { field: 'bpjs_kesehatan', label: 'BPJS Kesehatan', needsAttachment: true },
      { field: 'bpjs_ketenagakerjaan', label: 'BPJS Ketenagakerjaan', needsAttachment: true }
    ]
  },
  {
    title: 'Data Lainnya',
    hint: 'Status pernikahan: lampirkan buku nikah / KK',
    fields: [
      { field: 'marital_status', label: 'Status Pernikahan', type: 'select', options: MARITAL_OPTIONS, needsAttachment: true },
      { field: 'religion', label: 'Agama', type: 'select', options: RELIGION_OPTIONS, needsAttachment: false },
      { field: 'gender', label: 'Jenis Kelamin', type: 'select', options: GENDER_OPTIONS, needsAttachment: false }
    ]
  }
];

export const REQUEST_FIELD_MAP: Record<string, RequestFieldDef> = Object.fromEntries(
  REQUEST_GROUPS.flatMap((g) => g.fields).map((f) => [f.field, f])
);

// ── Types ──

export type ChangeRequestItem = { field: string; label: string; old: string; new: string };

export type ChangeRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export type ChangeRequest = {
  id: number;
  employee: number;
  employee_name: string;
  employee_code: string;
  items: ChangeRequestItem[];
  note: string;
  status: ChangeRequestStatus;
  status_display: string;
  attachment_name: string;
  attachment_url: string | null;
  requested_by_name: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  rejection_reason: string;
  created_at: string;
};

export const CHANGE_STATUS_VARIANT: Record<ChangeRequestStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  PENDING: 'secondary',
  APPROVED: 'default',
  REJECTED: 'destructive',
  CANCELLED: 'outline'
};

// ── Employee self-service ──

/** Direct edit of contact data (SELF_EDIT_FIELDS only). */
export function updateMyContact(data: Partial<Record<SelfEditField, string>>): Promise<Employee> {
  return request<Employee>('/auth/me/employee/', { method: 'PATCH', body: JSON.stringify(data) });
}

export function listMyChangeRequests(): Promise<ChangeRequest[]> {
  return request<ChangeRequest[]>('/auth/me/employee/change-requests/');
}

export function submitChangeRequest(changes: Record<string, string>, note: string, attachment?: File | null): Promise<ChangeRequest> {
  const fd = new FormData();
  fd.append('changes', JSON.stringify(changes));
  fd.append('note', note);
  if (attachment) fd.append('attachment', attachment);
  return request<ChangeRequest>('/auth/me/employee/change-requests/', { method: 'POST', body: fd });
}

export function cancelMyChangeRequest(id: number): Promise<ChangeRequest> {
  return request<ChangeRequest>(`/auth/me/employee/change-requests/${id}/cancel/`, { method: 'POST' });
}

// ── HR review (HR Staff / HR Lead / Admin) ──

export type ChangeRequestPage = { count: number; results: ChangeRequest[] };

export function listChangeRequests(params: Record<string, string> = {}): Promise<ChangeRequestPage> {
  const qs = new URLSearchParams(params);
  return request<ChangeRequest[] | ChangeRequestPage>(`/employee-change-requests/${qs.size ? `?${qs}` : ''}`).then((d) =>
    Array.isArray(d) ? { count: d.length, results: d } : d
  );
}

export function approveChangeRequest(id: number): Promise<ChangeRequest> {
  return request<ChangeRequest>(`/employee-change-requests/${id}/approve/`, { method: 'POST' });
}

export function rejectChangeRequest(id: number, rejection_reason: string): Promise<ChangeRequest> {
  return request<ChangeRequest>(`/employee-change-requests/${id}/reject/`, {
    method: 'POST',
    body: JSON.stringify({ rejection_reason })
  });
}
