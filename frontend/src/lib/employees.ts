import { AUTH_API_BASE } from '@/lib/auth/auth-config';

const BASE = `${AUTH_API_BASE}/api`;

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

export type Employee = {
  id: number;
  employee_id: string;
  full_name: string;
  nik: string;
  birth_place: string;
  birth_date: string | null;
  address: string;
  phone: string;
  personal_email: string;
  company_email: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  bank_account_number: string;
  bank_account_name: string;
  npwp: string;
  bpjs_kesehatan: string;
  bpjs_ketenagakerjaan: string;
  status: string;
  department: number | null;
  department_name: string;
  position: number | null;
  position_name: string;
  manager: number | null;
  manager_name: string;
  join_date: string | null;
  employment_status: string;
};

export type Contract = {
  id: number;
  employee: number;
  contract_type: string;
  contract_number: string | null;
  start_date: string;
  end_date: string | null;
  probation_enabled: boolean;
  probation_start_date: string | null;
  probation_end_date: string | null;
  status: string;
  is_current: boolean;
  termination_date: string | null;
  termination_reason: string;
  notes: string;
  document: string | null;
  activate?: boolean;
  created_at: string;
  updated_at: string;
};

export type History = {
  id: number;
  employee: number;
  date: string;
  history_type: string;
  previous_department_name: string;
  previous_position_name: string;
  new_department_name: string;
  new_position_name: string;
  notes: string;
  created_at: string;
};

export type Document = {
  id: number;
  employee: number;
  contract: number | null;
  name: string;
  content_type: string;
  size: number;
  version: number;
  created_at: string;
  url: string;
};

export type Department = {
  id: number;
  name: string;
  code: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  employee_count?: number;
};
export type Position = {
  id: number;
  name: string;
  code: string;
  department: number | null;
  department_name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  employee_count?: number;
};

export type Page<T> = { count: number; next: string | null; previous: string | null; results: T[] };

export function listEmployees(params: Record<string, string | number | undefined> = {}): Promise<Page<Employee>> {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v));
  return request<Page<Employee>>(`/employees/?${q.toString()}`);
}

export function getEmployee(id: number): Promise<Employee> {
  return request<Employee>(`/employees/${id}/`);
}

export function createEmployee(data: Partial<Employee>): Promise<Employee> {
  return request<Employee>('/employees/', { method: 'POST', body: JSON.stringify(data) });
}

export function updateEmployee(id: number, data: Partial<Employee>): Promise<Employee> {
  return request<Employee>(`/employees/${id}/`, { method: 'PATCH', body: JSON.stringify(data) });
}

export function deleteEmployee(id: number, hard = false): Promise<void> {
  return request<void>(`/employees/${id}/${hard ? 'hard-delete/' : ''}`, { method: 'DELETE' });
}

export function listContracts(id: number): Promise<Contract[]> {
  return request<Contract[]>(`/employees/${id}/contracts/`);
}

export function addContract(id: number, data: Partial<Contract>): Promise<Contract> {
  return request<Contract>(`/employees/${id}/contracts/`, { method: 'POST', body: JSON.stringify(data) });
}

export function editContract(id: number, contractId: number, data: Partial<Contract>): Promise<Contract> {
  return request<Contract>(`/employees/${id}/contracts/${contractId}/edit/`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function activateContract(id: number, contractId: number): Promise<Contract> {
  return request<Contract>(`/employees/${id}/contracts/${contractId}/activate/`, { method: 'POST' });
}

export function terminateContract(
  id: number,
  contractId: number,
  data: { termination_date?: string | null; termination_reason?: string }
): Promise<Contract> {
  return request<Contract>(`/employees/${id}/contracts/${contractId}/terminate/`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function deleteContract(id: number, contractId: number, hard = false): Promise<void> {
  return request<void>(`/employees/${id}/contracts/${contractId}/${hard ? 'hard-delete/' : ''}`, { method: 'DELETE' });
}

export function renewContract(id: number, contractId: number, data: Partial<Contract>): Promise<Contract> {
  return request<Contract>(`/employees/${id}/contracts/${contractId}/renew/`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function listHistory(id: number): Promise<History[]> {
  return request<History[]>(`/employees/${id}/history/`);
}

export function addHistory(id: number, data: Partial<History>): Promise<History> {
  return request<History>(`/employees/${id}/history/`, { method: 'POST', body: JSON.stringify(data) });
}

export function listDocuments(id: number): Promise<Document[]> {
  return request<Document[]>(`/employees/${id}/documents/`);
}

export function uploadDocument(id: number, file: File, contract?: number): Promise<Document> {
  const fd = new FormData();
  fd.append('file', file);
  if (contract) fd.append('contract', String(contract));
  return request<Document>(`/employees/${id}/documents/`, { method: 'POST', body: fd });
}

export function deleteDocument(id: number, docId: number, hard = false): Promise<void> {
  return request<void>(`/employees/${id}/documents/${docId}/${hard ? 'hard-delete/' : ''}`, { method: 'DELETE' });
}

export function listDepartments(): Promise<Department[]> {
  return request<Department[]>('/departments/');
}

export function createDepartment(data: Partial<Department>): Promise<Department> {
  return request<Department>('/departments/', { method: 'POST', body: JSON.stringify(data) });
}

export function updateDepartment(id: number, data: Partial<Department>): Promise<Department> {
  return request<Department>(`/departments/${id}/`, { method: 'PATCH', body: JSON.stringify(data) });
}

export function deleteDepartment(id: number, hard = false): Promise<void> {
  return request<void>(`/departments/${id}/${hard ? 'hard-delete/' : ''}`, { method: 'DELETE' });
}

export function listPositions(department?: number): Promise<Position[]> {
  const q = department ? `?department=${department}` : '';
  return request<Position[]>(`/positions/${q}`);
}

export function createPosition(data: Partial<Position>): Promise<Position> {
  return request<Position>('/positions/', { method: 'POST', body: JSON.stringify(data) });
}

export function updatePosition(id: number, data: Partial<Position>): Promise<Position> {
  return request<Position>(`/positions/${id}/`, { method: 'PATCH', body: JSON.stringify(data) });
}

export function deletePosition(id: number, hard = false): Promise<void> {
  return request<void>(`/positions/${id}/${hard ? 'hard-delete/' : ''}`, { method: 'DELETE' });
}

export type ImportResult = { created: number; errors: { row: number; error: string }[] };

export function importEmployees(file: File): Promise<ImportResult> {
  const fd = new FormData();
  fd.append('file', file);
  return request<ImportResult>('/employees/import_csv/', { method: 'POST', body: fd });
}
