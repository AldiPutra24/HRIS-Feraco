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

export type ManagementPendingLeave = {
  id: number;
  employee_name: string;
  leave_type_name: string;
  start_date: string;
  end_date: string;
  total_days: number;
};

export type ManagementTeamMember = {
  id: number;
  full_name: string;
  employee_id: string;
  position_name: string | null;
  department_name: string | null;
  employment_status: string;
};

export type ManagementDashboard = {
  team: {
    total: number;
    active: number;
    inactive: number;
    by_department: { department: number | null; department_name: string; count: number }[];
  };
  leave: {
    pending: number;
    approved: number;
    rejected: number;
    cancelled: number;
    total: number;
  };
  pending_leave_items: ManagementPendingLeave[];
  team_members: ManagementTeamMember[];
};

export function getManagementDashboard(): Promise<ManagementDashboard> {
  return request<ManagementDashboard>('/dashboard/management/');
}
