import { AUTH_API_BASE } from '@/lib/auth/auth-config';

const BASE = `${AUTH_API_BASE}/api/payroll`;

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
    const msg = extractError(data) || `API error ${res.status}`;
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ponytail: unwrap DRF paginated {count, results}; drop when payroll endpoints set pagination_class=None
function unwrapList<T>(data: T[] | { results?: T[] }): T[] {
  return Array.isArray(data) ? data : (data.results ?? []);
}

export type PayrollComponent = {
  id: number;
  name: string;
  code: string;
  category: 'EARNING_FIXED' | 'EARNING_VARIABLE' | 'DEDUCTION';
  calculation_type: 'FIXED_AMOUNT' | 'VARIABLE' | 'PERCENTAGE';
  default_amount: string | null;
  is_active: boolean;
  description: string;
  sort_order: number;
  is_reimbursement: boolean;
};

export type SalaryStructure = {
  id: number;
  employee: number;
  employee_name: string;
  effective_from: string;
  effective_to: string | null;
  basic_salary: string;
  components: { code: string; name: string; amount: string }[];
  is_active: boolean;
  created_at: string;
};

export function listComponents(): Promise<PayrollComponent[]> {
  return request<PayrollComponent[]>('/components/').then(unwrapList);
}

export function createComponent(data: Record<string, unknown>): Promise<PayrollComponent> {
  return request<PayrollComponent>('/components/', { method: 'POST', body: JSON.stringify(data) });
}

export function updateComponent(id: number, data: Record<string, unknown>): Promise<PayrollComponent> {
  return request<PayrollComponent>(`/components/${id}/`, { method: 'PATCH', body: JSON.stringify(data) });
}

export function deleteComponent(id: number): Promise<void> {
  return request<void>(`/components/${id}/`, { method: 'DELETE' });
}

export function listStructures(params?: Record<string, string>): Promise<SalaryStructure[]> {
  const qs = params ? `?${new URLSearchParams(params)}` : '';
  return request<SalaryStructure[]>(`/salary-structures/${qs}`).then(unwrapList);
}

export function createStructure(data: Record<string, unknown>): Promise<SalaryStructure> {
  return request<SalaryStructure>('/salary-structures/', { method: 'POST', body: JSON.stringify(data) });
}

export function historyStructures(employeeId: number): Promise<SalaryStructure[]> {
  return request<SalaryStructure[]>(`/salary-structures/${employeeId}/history/`).then(unwrapList);
}

export function activeStructure(): Promise<SalaryStructure | null> {
  return request<SalaryStructure | null>('/salary-structures/active/');
}

// ---------- Payroll Processing (Tahap 2) ----------

export type PayrollPeriod = {
  id: number;
  period_month: number;
  period_year: number;
  period_start: string;
  period_end: string;
  status: string;
  status_display: string;
  created_by: number | null;
  notes: string;
  payroll_count: number;
  created_at: string;
  updated_at: string;
};

export type PayrollItem = {
  id: number;
  payroll: number;
  payroll_component: number | null;
  component_name: string;
  component_code: string;
  category: 'EARNING_FIXED' | 'EARNING_VARIABLE' | 'DEDUCTION';
  amount: string;
  source: 'SYSTEM' | 'MANUAL';
  description: string;
  created_at: string;
};

export type Payroll = {
  id: number;
  period: number;
  employee: number;
  employee_name: string;
  basic_salary: string;
  total_fixed_earning: string;
  total_variable_earning: string;
  total_deduction: string;
  reimbursement_total: string;
  gross_salary: string;
  net_salary: string;
  items: PayrollItem[];
  created_at: string;
  updated_at: string;
};

export function listPeriods(): Promise<PayrollPeriod[]> {
  return request<PayrollPeriod[]>('/periods/').then(unwrapList);
}

export function createPeriod(data: Record<string, unknown>): Promise<PayrollPeriod> {
  return request<PayrollPeriod>('/periods/', { method: 'POST', body: JSON.stringify(data) });
}

export function deletePeriod(id: number): Promise<void> {
  return request<void>(`/periods/${id}/`, { method: 'DELETE' });
}

export function transitionPeriod(id: number, action: string): Promise<PayrollPeriod> {
  return request<PayrollPeriod>(`/periods/${id}/${action}/`, { method: 'POST' });
}

export function listPayrolls(periodId: number): Promise<Payroll[]> {
  return request<Payroll[]>(`/payrolls/?period=${periodId}`).then(unwrapList);
}

export function addManualItem(payrollId: number, componentCode: string, amount: string, description?: string): Promise<Payroll> {
  return request<Payroll>(`/payrolls/${payrollId}/manual_item/`, {
    method: 'POST',
    body: JSON.stringify({ component_code: componentCode, amount, description }),
  });
}

export function removeManualItem(payrollId: number, componentCode: string): Promise<Payroll> {
  return request<Payroll>(`/payrolls/${payrollId}/remove_manual_item/`, {
    method: 'POST',
    body: JSON.stringify({ component_code: componentCode }),
  });
}
