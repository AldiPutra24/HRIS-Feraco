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
    /** PENDING requests of direct reports — the ones this user can decide. */
    awaiting_me: number;
  };
  pending_leave_items: ManagementPendingLeave[];
  team_members: ManagementTeamMember[];
  /** General Manager only: company-wide read-only overview. */
  company?: CompanyOverview;
};

export type CompanyDepartment = { id: number | null; name: string; total: number; active: number };

export type CompanyContractEnding = {
  id: number;
  employee: number;
  employee_name: string;
  employee_id: string;
  position_name: string | null;
  department_name: string | null;
  contract_type: string;
  pkwt_sequence: number | null;
  end_date: string;
  days_left: number;
};

export type CompanyEmployee = {
  id: number;
  full_name: string;
  employee_id: string;
  department_name: string | null;
  position_name: string | null;
  manager_name: string | null;
  join_date: string | null;
  employment_status: string;
};

export type CompanyOverview = {
  summary: {
    total_employees: number;
    active_employees: number;
    inactive_employees: number;
    total_departments: number;
    total_positions: number;
  };
  departments: CompanyDepartment[];
  contracts_ending: CompanyContractEnding[];
  contracts_ending_30d: number;
  latest_employees: CompanyEmployee[];
};

export function getManagementDashboard(): Promise<ManagementDashboard> {
  return request<ManagementDashboard>('/dashboard/management/');
}
