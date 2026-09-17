import { AUTH_API_BASE } from '@/lib/auth/auth-config';

const BASE = `${AUTH_API_BASE}/api/notifications`;

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

export type NotificationKind =
  | 'LEAVE_SUBMITTED'
  | 'LEAVE_APPROVED'
  | 'LEAVE_REJECTED'
  | 'CONTRACT'
  | 'BIRTHDAY';

export const NOTIFICATION_KIND_LABELS: Record<NotificationKind, string> = {
  LEAVE_SUBMITTED: 'Izin/Cuti',
  LEAVE_APPROVED: 'Izin/Cuti',
  LEAVE_REJECTED: 'Izin/Cuti',
  CONTRACT: 'Kontrak',
  BIRTHDAY: 'Birthday',
};

export type AppNotification = {
  id: number;
  kind: NotificationKind;
  title: string;
  message: string;
  link: string;
  object_id: string;
  is_read: boolean;
  created_at: string;
};

export type NotificationList = { results: AppNotification[]; unread: number };

export function listNotifications(): Promise<NotificationList> {
  return request<NotificationList>('/notifications/');
}

export function getUnreadCount(): Promise<{ unread: number }> {
  return request<{ unread: number }>('/notifications/unread_count/');
}

export function markNotificationRead(id: number): Promise<AppNotification> {
  return request<AppNotification>(`/notifications/${id}/mark_read/`, { method: 'POST' });
}

export function markAllNotificationsRead(): Promise<{ marked: number }> {
  return request<{ marked: number }>('/notifications/mark_all_read/', { method: 'POST' });
}

export type HrCandidate = { id: number; username: string; email: string; role: string };

export type NotificationSetting = {
  id: number;
  default_hr_emails: string;
  additional_hr_users: number[];
  additional_hr_details: HrCandidate[];
  birthday_h1_enabled: boolean;
  birthday_h0_enabled: boolean;
  contract_offsets: string;
  updated_at: string;
};

export function getNotificationSettings(): Promise<NotificationSetting> {
  return request<NotificationSetting>('/notification-settings/');
}

export function updateNotificationSettings(
  input: Partial<Omit<NotificationSetting, 'id' | 'additional_hr_details' | 'updated_at'>>,
): Promise<NotificationSetting> {
  return request<NotificationSetting>('/notification-settings/1/', {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function listHrCandidates(): Promise<HrCandidate[]> {
  return request<HrCandidate[]>('/notification-settings/hr_candidates/');
}

export type EventConfig = {
  id: number;
  event: string;
  enabled: boolean;
  subject: string;
  body: string;
  available_placeholders: string[];
  updated_at: string;
};

export const EVENT_CONFIG_LABELS: Record<string, string> = {
  LEAVE_SUBMITTED: 'Izin/Cuti — Pengajuan Baru',
  LEAVE_APPROVED: 'Izin/Cuti — Disetujui',
  LEAVE_REJECTED: 'Izin/Cuti — Ditolak',
  CONTRACT: 'End of Contract',
  BIRTHDAY_HR: 'Birthday — Email ke HR',
  BIRTHDAY_EMPLOYEE: 'Birthday — Email Ucapan ke Employee',
};

export function listEventConfigs(): Promise<EventConfig[]> {
  return request<EventConfig[]>('/notification-events/');
}

export function updateEventConfig(id: number, input: Partial<Pick<EventConfig, 'enabled' | 'subject' | 'body'>>): Promise<EventConfig> {
  return request<EventConfig>(`/notification-events/${id}/`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export type EventPreview = {
  event: string;
  subject: string;
  text: string;
  html: string;
  is_html: boolean;
};

/** Render a template (unsaved editor content allowed) with dummy data. */
export function previewEventConfig(input: {
  event: string;
  subject?: string;
  body?: string;
}): Promise<EventPreview> {
  return request<EventPreview>('/notification-events/preview/', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export type DeliveryChannel = 'EMAIL' | 'IN_APP';
export type DeliveryStatus = 'SENT' | 'FAILED' | 'SKIPPED';
export type DeliveryEvent =
  | 'LEAVE_SUBMITTED'
  | 'LEAVE_APPROVED'
  | 'LEAVE_REJECTED'
  | 'CONTRACT'
  | 'BIRTHDAY';

export type DeliveryLog = {
  id: number;
  key: string;
  channel: DeliveryChannel;
  event: DeliveryEvent;
  recipient_email: string;
  recipient_username: string | null;
  subject: string;
  status: DeliveryStatus;
  detail: string;
  created_at: string;
};

export type DeliveryLogPage = { count: number; next: string | null; previous: string | null; results: DeliveryLog[] };

export type DeliveryLogFilters = {
  channel?: string;
  status?: string;
  event?: string;
  search?: string;
  date_from?: string;
  date_to?: string;
  page?: number;
};

export type DeliverySummary = {
  total: number;
  sent: number;
  failed: number;
  skipped: number;
};

export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  SENT: 'Terkirim',
  FAILED: 'Gagal',
  SKIPPED: 'Dilewati',
};

export const DELIVERY_CHANNEL_LABELS: Record<DeliveryChannel, string> = {
  EMAIL: 'Email',
  IN_APP: 'In-app',
};

export const DELIVERY_EVENT_LABELS: Record<string, string> = {
  LEAVE_SUBMITTED: 'Izin/Cuti — Pengajuan Baru',
  LEAVE_APPROVED: 'Izin/Cuti — Disetujui',
  LEAVE_REJECTED: 'Izin/Cuti — Ditolak',
  CONTRACT: 'End of Contract',
  BIRTHDAY: 'Birthday',
};

export function listDeliveryLogs(params: DeliveryLogFilters = {}): Promise<DeliveryLogPage> {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(String(k), String(v));
  const suffix = q.toString();
  return request<DeliveryLogPage>(`/delivery-logs/${suffix ? `?${suffix}` : ''}`);
}

export function getDeliverySummary(params: DeliveryLogFilters = {}): Promise<DeliverySummary> {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(String(k), String(v));
  const suffix = q.toString();
  return request<DeliverySummary>(`/delivery-logs/summary/${suffix ? `?${suffix}` : ''}`);
}
