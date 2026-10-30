import { AUTH_API_BASE } from '@/lib/auth/auth-config';

const BASE = `${AUTH_API_BASE}/api/recruitment`;

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

export type RecruitmentType = 'INHOUSE' | 'FREELANCE';

/** Freelance job position from the freelance Skill master. */
export type JobSkill = { id: number; name: string; category: string | null };

export type Job = {
  id: number;
  title: string;
  slug: string;
  department: number | null;
  department_name: string;
  position: number | null;
  position_name: string;
  position_text?: string;
  skills: number[];
  skill_details: JobSkill[];
  description: string;
  requirements: string;
  employment_type: string;
  recruitment_type: RecruitmentType;
  location: string;
  open_date: string;
  close_date: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  applications_count: number;
};

export type PublicJob = {
  id: number;
  title: string;
  slug: string;
  department_name: string;
  position_name: string;
  position_text?: string;
  skill_details?: JobSkill[];
  description: string;
  requirements: string;
  employment_type: string;
  recruitment_type?: string;
  location: string;
  open_date: string;
  close_date: string | null;
};

export type CandidateStatusHistory = {
  id: number;
  from_status: string;
  to_status: string;
  changed_by_name: string | null;
  changed_at: string;
  note: string;
};

export type Interview = {
  id: number;
  application: number;
  stage: string;
  scheduled_at: string | null;
  interviewer: number | null;
  interviewer_name: string;
  interviewer_label: string | null;
  result: string;
  notes: string;
  created_at: string;
  updated_at: string;
};

export type Candidate = {
  id: number;
  profile: number;
  profile_code: string;
  track: RecruitmentType | 'UNDECIDED';
  /** Null = Open Application / Talent Pool. */
  job: number | null;
  job_title: string | null;
  recruitment_type: RecruitmentType | null;
  full_name: string;
  email: string;
  phone: string;
  employment_types: string[];
  cv_name: string;
  cv_url: string | null;
  source: string;
  status: string;
  inactive_reason: string;
  inactive_note: string;
  legacy_status: string;
  screening_result: string;
  screening_notes: string;
  screened_at: string | null;
  screened_by_name: string | null;
  interviews: Interview[];
  next_statuses: string[];
  status_history: CandidateStatusHistory[];
  talent_pool_freelancer_id: number | null;
  applied_skill: JobSkill | null;
  applied_at: string;
  created_at: string;
};

type Page<T> = { results: T[]; count: number };

function unwrapList<T>(data: T[] | Page<T>): T[] {
  if (Array.isArray(data)) return data;
  return data.results ?? [];
}

export function listJobs(params: Record<string, string> = {}): Promise<Job[]> {
  const qs = new URLSearchParams(params).toString();
  return request<Job[]>(`/jobs/${qs ? `?${qs}` : ''}`).then(unwrapList);
}

export function getJob(id: number): Promise<Job> {
  return request<Job>(`/jobs/${id}/`);
}

/** Accept a freelance candidate into the Freelance/Talent Pool. */
export function acceptCandidateFreelance(id: number): Promise<{ freelancer_id: number; created: boolean; detail: string }> {
  return request(`/candidates/${id}/accept-freelance/`, { method: 'POST' });
}

export type JobInput = {
  title: string;
  department: number | null;
  position: number | null;
  position_text?: string;
  skills?: number[];
  description: string;
  requirements: string;
  employment_type: string;
  recruitment_type: RecruitmentType;
  location: string;
  open_date: string;
  close_date: string | null;
};

export function createJob(input: JobInput): Promise<Job> {
  return request<Job>('/jobs/', { method: 'POST', body: JSON.stringify(input) });
}

export function updateJob(id: number, input: JobInput): Promise<Job> {
  return request<Job>(`/jobs/${id}/`, { method: 'PUT', body: JSON.stringify(input) });
}

export function deleteJob(id: number): Promise<void> {
  return request<void>(`/jobs/${id}/`, { method: 'DELETE' });
}

export function hardDeleteJob(id: number): Promise<void> {
  return request<void>(`/jobs/${id}/hard-delete/`, { method: 'DELETE' });
}

export function openJob(id: number): Promise<Job> {
  return request<Job>(`/jobs/${id}/open/`, { method: 'POST' });
}

export function closeJob(id: number): Promise<Job> {
  return request<Job>(`/jobs/${id}/close/`, { method: 'POST' });
}

export function reopenJob(id: number): Promise<Job> {
  return request<Job>(`/jobs/${id}/reopen/`, { method: 'POST' });
}

export function listCandidates(params: Record<string, string> = {}): Promise<Candidate[]> {
  const qs = new URLSearchParams(params).toString();
  return request<Candidate[]>(`/candidates/${qs ? `?${qs}` : ''}`).then(unwrapList);
}

/** Unified public form (Talent Pool): open vacancies + Open Application. */
export type ApplyOptionJob = {
  id: number;
  slug: string;
  title: string;
  recruitment_type: RecruitmentType;
  location: string;
  skills: JobSkill[];
};

export type ApplyOptions = {
  jobs: ApplyOptionJob[];
  consent_text: string;
  consent_version: string;
};

export function getApplyOptions(): Promise<ApplyOptions> {
  return request<ApplyOptions>('/public/apply-options/');
}

/** Multipart submit of the unified form (CV required). */
export function submitApplication(body: FormData): Promise<{ detail: string }> {
  return request<{ detail: string }>('/public/apply/', { method: 'POST', body });
}

/** HR: decide the track (and optionally a vacancy) of an application. */
export function assignCandidate(id: number, track: RecruitmentType, job: number | null = null): Promise<Candidate> {
  return request<Candidate>(`/candidates/${id}/assign/`, {
    method: 'POST',
    body: JSON.stringify({ track, job })
  });
}

export function getCandidate(id: number): Promise<Candidate> {
  return request<Candidate>(`/candidates/${id}/`);
}

export function deleteCandidate(id: number): Promise<void> {
  return request<void>(`/candidates/${id}/`, { method: 'DELETE' });
}

export function hardDeleteCandidate(id: number): Promise<void> {
  return request<void>(`/candidates/${id}/hard-delete/`, { method: 'DELETE' });
}

/** Direct link that streams the candidate's CV from the backend (`?raw=1`). */
export function candidateCvFileUrl(c: { cv_url?: string | null }): string | null {
  return c.cv_url ? `${c.cv_url}?raw=1` : null;
}

export function getCandidateCv(id: number): Promise<{ url: string; name: string }> {
  return request<{ url: string; name: string }>(`/candidates/${id}/cv/`);
}

export function transitionCandidate(
  id: number,
  status: string,
  note = '',
  inactiveReason = ''
): Promise<Candidate> {
  return request<Candidate>(`/candidates/${id}/transition/`, {
    method: 'POST',
    body: JSON.stringify({ status, note, inactive_reason: inactiveReason })
  });
}

/** Record the screening result (notes required). NEW moves to SCREENED. */
export function screenCandidate(id: number, result: string, notes: string): Promise<Candidate> {
  return request<Candidate>(`/candidates/${id}/screening/`, {
    method: 'POST',
    body: JSON.stringify({ result, notes })
  });
}

export type InterviewInput = {
  application: number;
  stage: string;
  scheduled_at: string | null;
  interviewer_name: string;
  result: string;
  notes: string;
};

export function createInterview(input: InterviewInput): Promise<Interview> {
  return request<Interview>('/interviews/', { method: 'POST', body: JSON.stringify(input) });
}

export function updateInterview(id: number, input: Partial<InterviewInput>): Promise<Interview> {
  return request<Interview>(`/interviews/${id}/`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function deleteInterview(id: number): Promise<void> {
  return request<void>(`/interviews/${id}/`, { method: 'DELETE' });
}

export function listPublicJobs(): Promise<PublicJob[]> {
  return request<PublicJob[]>('/public/jobs/');
}

export function getPublicJob(slug: string): Promise<PublicJob> {
  return request<PublicJob>(`/public/jobs/${slug}/`);
}

/* ---------------------------------------------------------------- Talent Pool */

export type ProfileApplication = {
  id: number;
  job: number | null;
  job_title: string | null;
  track: RecruitmentType | 'UNDECIDED';
  status: string;
  inactive_reason: string;
  source: string;
  created_at: string;
  updated_at: string;
};

export type TalentProfile = {
  id: number;
  code: string;
  full_name: string;
  email: string;
  phone: string;
  city: string;
  employment_types: string[];
  preferred_location: string;
  employment_status: string;
  availability: string;
  source_reported: string;
  possible_duplicate_of: number | null;
  possible_duplicate_code: string | null;
  freelancer: number | null;
  employee: number | null;
  consent_at: string | null;
  consent_withdrawn_at: string | null;
  anonymized_at: string | null;
  applications_count: number;
  last_activity: string;
  latest_application: ProfileApplication | null;
  created_at: string;
  updated_at: string;
};

export type TalentProfileDetail = TalentProfile & {
  linkedin_url: string;
  portfolio_url: string;
  preferred_location_other: string;
  employment_status_other: string;
  expected_monthly_salary: string | null;
  expected_project_fee: string | null;
  source_other: string;
  consent_version: string;
  cv_name: string;
  cv_url: string | null;
  applications: ProfileApplication[];
};

export type TalentProfileInput = Partial<
  Pick<
    TalentProfileDetail,
    | 'full_name'
    | 'phone'
    | 'city'
    | 'linkedin_url'
    | 'portfolio_url'
    | 'employment_types'
    | 'preferred_location'
    | 'employment_status'
    | 'availability'
    | 'expected_monthly_salary'
    | 'expected_project_fee'
  >
>;

export function listTalentProfiles(params: Record<string, string> = {}): Promise<Page<TalentProfile>> {
  const qs = new URLSearchParams(params).toString();
  return request<Page<TalentProfile>>(`/talent-pool/${qs ? `?${qs}` : ''}`);
}

export function getTalentProfile(id: number): Promise<TalentProfileDetail> {
  return request<TalentProfileDetail>(`/talent-pool/${id}/`);
}

export function updateTalentProfile(id: number, input: TalentProfileInput): Promise<TalentProfileDetail> {
  return request<TalentProfileDetail>(`/talent-pool/${id}/`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function mergeTalentProfile(id: number, into: number): Promise<TalentProfileDetail> {
  return request<TalentProfileDetail>(`/talent-pool/${id}/merge/`, { method: 'POST', body: JSON.stringify({ into }) });
}

export function markNotDuplicate(id: number): Promise<TalentProfileDetail> {
  return request<TalentProfileDetail>(`/talent-pool/${id}/not-duplicate/`, { method: 'POST' });
}

export function createProfileApplication(id: number, job: number | null, track?: RecruitmentType): Promise<ProfileApplication> {
  return request<ProfileApplication>(`/talent-pool/${id}/applications/`, {
    method: 'POST',
    body: JSON.stringify({ job, ...(track ? { track } : {}) })
  });
}

export function anonymizeTalentProfile(id: number): Promise<TalentProfileDetail> {
  return request<TalentProfileDetail>(`/talent-pool/${id}/anonymize/`, { method: 'POST' });
}

/** Direct link that streams the profile's latest CV (`?raw=1`). */
export function profileCvFileUrl(p: { cv_url?: string | null }): string | null {
  return p.cv_url ? `${p.cv_url}?raw=1` : null;
}

/* ---------------------------------------------------------------- Dashboards */

export type CountRow = { key: string; label: string; count: number };

export type TalentPoolDashboard = {
  total_profiles: number;
  total_applications: number;
  qualified_profiles: number;
  available_profiles: number;
  by_employment_type: CountRow[];
  by_interest: CountRow[];
  by_source: CountRow[];
  by_availability: CountRow[];
  by_month: { month: string; count: number }[];
};

export type PipelineDashboard = {
  total_applications: number;
  by_stage: CountRow[];
  hr_interview: number;
  user_interview: number;
  hired: number;
  awaiting_follow_up: number;
  follow_up: { id: number; full_name: string; status: string; position: string; updated_at: string }[];
  by_source: CountRow[];
  by_position: { position: string; track: string; total: number; statuses: Record<string, number> }[];
};

function withQuery(path: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
  return `${path}${qs ? `?${qs}` : ''}`;
}

export function getTalentPoolDashboard(params: Record<string, string> = {}): Promise<TalentPoolDashboard> {
  return request<TalentPoolDashboard>(withQuery('/dashboard/talent-pool/', params));
}

export function getPipelineDashboard(params: Record<string, string> = {}): Promise<PipelineDashboard> {
  return request<PipelineDashboard>(withQuery('/dashboard/pipeline/', params));
}
