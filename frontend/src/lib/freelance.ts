import { AUTH_API_BASE } from '@/lib/auth/auth-config';

const BASE = `${AUTH_API_BASE}/api/freelance`;

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

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
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

export type Recommendation = 'RECOMMENDED' | 'RECOMMENDED_NOTES' | 'NOT_RECOMMENDED';

export const RECOMMENDATION_LABELS: Record<Recommendation, string> = {
  RECOMMENDED: 'Recommended',
  RECOMMENDED_NOTES: 'Recommended with Notes',
  NOT_RECOMMENDED: 'Not Recommended',
};

export type RateType = 'PER_DAY' | 'PER_EVENT';

export const RATE_TYPE_LABELS: Record<RateType, string> = {
  PER_DAY: 'Per Hari',
  PER_EVENT: 'Per Event',
};

export type FreelancerStatus = 'ACTIVE' | 'INACTIVE' | 'TERMINATED';

export type SkillTag = { id: number; name: string; category: string | null };

export type FreelancerSkill = {
  id: number;
  skill: number;
  skill_name: string;
  category_name: string | null;
  note: string;
  created_at: string;
};

export type FreelancerDocument = {
  id: number;
  freelancer: number;
  doc_type: string;
  name: string;
  url: string;
  storage_path: string;
  content_type: string;
  size: number;
  download_url: string | null;
  created_at: string;
};

export type FreelancerPerformance = {
  id: number;
  assignment: number;
  rating: number | null;
  recommendation: Recommendation | '';
  notes: string;
  evaluator: string;
  created_at: string;
  updated_at: string;
};

export type EventAssignment = {
  id: number;
  freelancer: number;
  freelancer_name: string;
  event: number;
  event_name: string;
  role: string;
  pic: string;
  assigned_at: string | null;
  performance: FreelancerPerformance | null;
  created_at: string;
};

export type Freelancer = {
  id: number;
  full_name: string;
  whatsapp: string;
  personal_email: string;
  domicile: string;
  status: FreelancerStatus;
  rate: string | null;
  rate_type: RateType | '';
  rate_min: string | null;
  rate_max: string | null;
  is_blacklisted: boolean;
  blacklist_reason: string;
  skills: SkillTag[];
  avg_rating: number | null;
  recommendation: Recommendation | '';
  last_event: string | null;
  events: Array<{ id: number; name: string }>;
  created_at: string;
  updated_at: string;
};

export type FreelancerDetail = Omit<Freelancer, 'skills'> & {
  phone: string;
  address: string;
  contact_person: string;
  skills: FreelancerSkill[];
  documents: FreelancerDocument[];
  assignments: EventAssignment[];
};

export type Skill = {
  id: number;
  name: string;
  category: number | null;
  category_name: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type SkillCategory = {
  id: number;
  name: string;
  is_active: boolean;
  skill_count: number;
  created_at: string;
  updated_at: string;
};

export type FreelanceEvent = {
  id: number;
  name: string;
  event_date: string | null;
  location: string;
  client: string;
  description: string;
  assignment_count: number;
  created_at: string;
  updated_at: string;
};

type Page<T> = { results: T[]; count: number; next: string | null; previous: string | null };

function unwrapList<T>(data: T[] | Page<T>): T[] {
  if (Array.isArray(data)) return data;
  return data.results ?? [];
}

export function listFreelancers(params: Record<string, string> = {}): Promise<Freelancer[]> {
  // page_size=1000: fetch the whole pool in one request — the default page of
  // 20 hid freelancers that were mapped from recruitment into the pool.
  const qs = new URLSearchParams({ page_size: '1000', ...params }).toString();
  return request<Freelancer[] | Page<Freelancer>>(`/freelancers/?${qs}`).then(unwrapList);
}

export function getFreelancer(id: number): Promise<FreelancerDetail> {
  return request<FreelancerDetail>(`/freelancers/${id}/`);
}

export type FreelancerInput = {
  full_name: string;
  whatsapp?: string;
  personal_email?: string;
  phone?: string;
  address?: string;
  domicile?: string;
  status?: FreelancerStatus;
  contact_person?: string;
  rate?: string | null;
  rate_type?: RateType | '';
  rate_min?: string | null;
  rate_max?: string | null;
  is_blacklisted?: boolean;
  blacklist_reason?: string;
};

export function createFreelancer(input: FreelancerInput): Promise<FreelancerDetail> {
  return request<FreelancerDetail>('/freelancers/', { method: 'POST', body: JSON.stringify(input) });
}

export function updateFreelancer(id: number, input: Partial<FreelancerInput>): Promise<FreelancerDetail> {
  return request<FreelancerDetail>(`/freelancers/${id}/`, { method: 'PUT', body: JSON.stringify(input) });
}

export function deleteFreelancer(id: number): Promise<void> {
  return request<void>(`/freelancers/${id}/`, { method: 'DELETE' });
}

export function addFreelancerSkill(id: number, skill: number, note = ''): Promise<FreelancerSkill> {
  return request<FreelancerSkill>(`/freelancers/${id}/skills/`, { method: 'POST', body: JSON.stringify({ skill, note }) });
}

export function removeFreelancerSkill(id: number, skill: number): Promise<void> {
  return request<void>(`/freelancers/${id}/skills/?skill=${skill}`, { method: 'DELETE' });
}

export function listFreelancerDocuments(id: number): Promise<FreelancerDocument[]> {
  return request<FreelancerDocument[]>(`/freelancers/${id}/documents/`);
}

export function uploadFreelancerDocument(
  id: number,
  body: { doc_type?: string; name?: string; url?: string; file?: File },
): Promise<FreelancerDocument> {
  const fd = new FormData();
  if (body.doc_type) fd.append('doc_type', body.doc_type);
  if (body.name) fd.append('name', body.name);
  if (body.url) fd.append('url', body.url);
  if (body.file) fd.append('file', body.file);
  return request<FreelancerDocument>(`/freelancers/${id}/documents/`, { method: 'POST', body: fd });
}

export function deleteFreelancerDocument(id: number, docId: number): Promise<void> {
  return request<void>(`/freelancers/${id}/documents/${docId}/`, { method: 'DELETE' });
}

export type DocumentDownload = { url: string; name: string };

export function getFreelancerDocumentDownload(id: number, docId: number): Promise<DocumentDownload> {
  return request<DocumentDownload>(`/freelancers/${id}/documents/${docId}/download/`);
}

export function listSkills(params: Record<string, string> = {}): Promise<Skill[]> {
  const qs = new URLSearchParams(params).toString();
  return request<Skill[] | Page<Skill>>(`/skills/${qs ? `?${qs}` : ''}`).then(unwrapList);
}

export function createSkill(input: { name: string; category?: number | null }): Promise<Skill> {
  return request<Skill>('/skills/', { method: 'POST', body: JSON.stringify(input) });
}

export function deleteSkill(id: number): Promise<void> {
  return request<void>(`/skills/${id}/`, { method: 'DELETE' });
}

export function listSkillCategories(): Promise<SkillCategory[]> {
  return request<SkillCategory[] | Page<SkillCategory>>('/skill-categories/').then(unwrapList);
}

export function createSkillCategory(name: string): Promise<SkillCategory> {
  return request<SkillCategory>('/skill-categories/', { method: 'POST', body: JSON.stringify({ name }) });
}

export function deleteSkillCategory(id: number): Promise<void> {
  return request<void>(`/skill-categories/${id}/`, { method: 'DELETE' });
}

export function listEvents(params: Record<string, string> = {}): Promise<FreelanceEvent[]> {
  const qs = new URLSearchParams(params).toString();
  return request<FreelanceEvent[] | Page<FreelanceEvent>>(`/events/${qs ? `?${qs}` : ''}`).then(unwrapList);
}

export type EventInput = {
  name: string;
  event_date?: string | null;
  location?: string;
  client?: string;
  description?: string;
};

export function createEvent(input: EventInput): Promise<FreelanceEvent> {
  return request<FreelanceEvent>('/events/', { method: 'POST', body: JSON.stringify(input) });
}

export function updateEvent(id: number, input: Partial<EventInput>): Promise<FreelanceEvent> {
  return request<FreelanceEvent>(`/events/${id}/`, { method: 'PUT', body: JSON.stringify(input) });
}

export function deleteEvent(id: number): Promise<void> {
  return request<void>(`/events/${id}/`, { method: 'DELETE' });
}

export function listAssignments(params: Record<string, string> = {}): Promise<EventAssignment[]> {
  const qs = new URLSearchParams(params).toString();
  return request<EventAssignment[] | Page<EventAssignment>>(`/assignments/${qs ? `?${qs}` : ''}`).then(unwrapList);
}

export type AssignmentInput = {
  freelancer: number;
  event: number;
  role?: string;
  pic?: string;
  assigned_at?: string | null;
};

export function createAssignment(input: AssignmentInput): Promise<EventAssignment> {
  return request<EventAssignment>('/assignments/', { method: 'POST', body: JSON.stringify(input) });
}

export function updateAssignment(id: number, input: Partial<AssignmentInput>): Promise<EventAssignment> {
  return request<EventAssignment>(`/assignments/${id}/`, { method: 'PUT', body: JSON.stringify(input) });
}

export function deleteAssignment(id: number): Promise<void> {
  return request<void>(`/assignments/${id}/`, { method: 'DELETE' });
}

export type PerformanceInput = {
  rating?: number | null;
  recommendation?: Recommendation | '';
  notes?: string;
  evaluator?: string;
};

export function savePerformance(assignmentId: number, input: PerformanceInput): Promise<FreelancerPerformance> {
  return request<FreelancerPerformance>(`/assignments/${assignmentId}/performance/`, { method: 'POST', body: JSON.stringify(input) });
}

export type TaskStatus = 'BELUM_MULAI' | 'SEDANG_DIKERJAKAN' | 'SELESAI' | 'TERKENDALA';

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  BELUM_MULAI: 'Belum Mulai',
  SEDANG_DIKERJAKAN: 'Sedang Dikerjakan',
  SELESAI: 'Selesai',
  TERKENDALA: 'Terkendala',
};

export type TaskUpdate = {
  id: number;
  status: TaskStatus;
  note: string;
  created_by_name: string | null;
  created_at: string;
};

export type FreelanceTask = {
  id: number;
  event: number;
  event_name: string;
  freelancer: number;
  freelancer_name: string;
  title: string;
  description: string;
  deadline: string | null;
  status: TaskStatus;
  pic: number | null;
  pic_name: string | null;
  last_update: TaskUpdate | null;
  created_at: string;
  updated_at: string;
};

export type TaskInput = {
  event: number;
  freelancer: number;
  title: string;
  description?: string;
  deadline?: string | null;
  status?: TaskStatus;
  pic?: string;
};

export type EventTaskProgress = {
  total: number;
  BELUM_MULAI: number;
  SEDANG_DIKERJAKAN: number;
  SELESAI: number;
  TERKENDALA: number;
  percentage: number;
};

export function listTasks(params: Record<string, string> = {}): Promise<FreelanceTask[]> {
  const qs = new URLSearchParams(params).toString();
  return request<FreelanceTask[] | Page<FreelanceTask>>(`/tasks/${qs ? `?${qs}` : ''}`).then(unwrapList);
}

export function createTask(input: TaskInput): Promise<FreelanceTask> {
  return request<FreelanceTask>('/tasks/', { method: 'POST', body: JSON.stringify(input) });
}

export function updateTask(id: number, input: Partial<TaskInput>): Promise<FreelanceTask> {
  return request<FreelanceTask>(`/tasks/${id}/`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function deleteTask(id: number): Promise<void> {
  return request<void>(`/tasks/${id}/`, { method: 'DELETE' });
}

export function addTaskUpdate(id: number, input: { status?: TaskStatus; note?: string }): Promise<TaskUpdate> {
  return request<TaskUpdate>(`/tasks/${id}/updates/`, { method: 'POST', body: JSON.stringify(input) });
}

export function getEventTaskProgress(eventId: number): Promise<EventTaskProgress> {
  return request<EventTaskProgress>(`/events/${eventId}/task-progress/`);
}

export type TaskEscalationPolicy = {
  enabled: boolean;
  reminder_offsets: string;
  reminder_offset_list: number[];
  remind_freelancer: boolean;
  remind_pic: boolean;
  escalation_cc_emails: string;
  escalate_after_days: number;
  max_escalations: number;
  updated_by: number | null;
  created_at: string;
  updated_at: string;
};

export function getTaskScheduler(): Promise<TaskEscalationPolicy> {
  return request<TaskEscalationPolicy>('/task-scheduler/');
}

export function updateTaskScheduler(
  input: Partial<Pick<TaskEscalationPolicy, 'enabled' | 'reminder_offsets' | 'remind_freelancer' | 'remind_pic' | 'escalation_cc_emails' | 'escalate_after_days' | 'max_escalations'>>,
): Promise<TaskEscalationPolicy> {
  return request<TaskEscalationPolicy>('/task-scheduler/1/', { method: 'PATCH', body: JSON.stringify(input) });
}

export type SendRemindersResult = {
  sent: number;
  skipped: number;
  failed: number;
  details: { task_id: number; kind: string; offset_days: number | null; status: string }[];
};

export function sendTaskRemindersNow(): Promise<SendRemindersResult> {
  return request<SendRemindersResult>('/task-scheduler/send-now/', { method: 'POST' });
}
