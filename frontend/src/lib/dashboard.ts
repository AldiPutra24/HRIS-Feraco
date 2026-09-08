import { AUTH_API_BASE } from '@/lib/auth/auth-config';

const BASE = `${AUTH_API_BASE}/api`;

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const csrf = getCookie('csrftoken');
  const method = (init.method ?? 'GET').toUpperCase();
  if (csrf && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) headers.set('X-CSRFToken', csrf);
  const res = await fetch(`${BASE}${path}`, { ...init, headers, credentials: 'include' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const msg = typeof data.detail === 'string' ? data.detail : JSON.stringify(data);
    throw new Error(msg || `API error ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export type DashboardLeaveToday = {
  id: number;
  employee_name: string;
  leave_type_name: string;
  kind: string;
  status: string;
  start_date: string;
  end_date: string;
  total_days: number;
};

export type DashboardContractEnding = {
  id: number;
  employee_name: string;
  employee_id: string;
  position_name: string | null;
  contract_type: string;
  end_date: string;
  days_left: number;
};

export type DashboardBirthday = {
  id: number;
  full_name: string;
  birth_date: string;
  department_name: string | null;
  position_name: string | null;
};

export type DashboardAnnouncement = {
  id: number;
  title: string;
  body: string;
  created_at: string;
  created_by_name: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  use_end_date: boolean;
  end_date: string | null;
};

export type HrDashboard = {
  leave_today: DashboardLeaveToday[];
  contracts_ending: DashboardContractEnding[];
  birthdays: DashboardBirthday[];
  announcements: DashboardAnnouncement[];
};

export function getHrDashboard(): Promise<HrDashboard> {
  return request<HrDashboard>('/dashboard/hr/');
}
