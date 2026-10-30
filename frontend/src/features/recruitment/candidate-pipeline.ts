/** Application statuses per PRD §5.5 (talentpool.md Decision #4). */
export const PIPELINE = [
  'NEW',
  'SCREENED',
  'CONTACTED',
  'HR_INTERVIEW',
  'USER_INTERVIEW',
  'HIRED'
] as const;

export const ALL_STATUSES = [...PIPELINE, 'INACTIVE'] as const;

export type CandidateStatus = (typeof ALL_STATUSES)[number];

const STATUS_LABELS: Record<string, string> = {
  NEW: 'New',
  SCREENED: 'Screened',
  CONTACTED: 'Contacted',
  HR_INTERVIEW: 'HR Interview',
  USER_INTERVIEW: 'User Interview',
  HIRED: 'Hired / Assigned',
  INACTIVE: 'Inactive',
  // Pre-PRD statuses, still shown in migrated status history.
  APPLIED: 'Applied',
  SCREENING: 'Screening',
  INTERVIEW_HR: 'Interview HR',
  INTERVIEW_USER: 'Interview User',
  INTERVIEW_GM: 'Interview GM',
  OFFERING: 'Offering',
  OFFER_ACCEPTED: 'Offer Accepted',
  REJECTED: 'Rejected',
  WITHDRAWN: 'Withdrawn'
};

export function statusLabel(v: string): string {
  return STATUS_LABELS[v] ?? v.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export const INACTIVE_REASONS = [
  { value: 'NOT_QUALIFIED', label: 'Not Qualified' },
  { value: 'CANDIDATE_WITHDREW', label: 'Candidate Withdrew' },
  { value: 'UNRESPONSIVE', label: 'Unresponsive' },
  { value: 'NO_LONGER_AVAILABLE', label: 'No Longer Available' },
  { value: 'POSITION_CLOSED', label: 'Position Closed' },
  { value: 'OTHER', label: 'Other' }
] as const;

export function inactiveReasonLabel(v: string): string {
  return INACTIVE_REASONS.find((r) => r.value === v)?.label ?? v;
}

export const SCREENING_RESULT_LABELS: Record<string, string> = {
  QUALIFIED: 'Qualified',
  NOT_QUALIFIED: 'Not Qualified'
};

export const INTERVIEW_STAGES = [
  { value: 'HR', label: 'HR Interview' },
  { value: 'USER', label: 'User Interview' },
  { value: 'SKILL_TEST', label: 'Skill Test' }
] as const;

export const INTERVIEW_RESULTS = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'PASSED', label: 'Passed' },
  { value: 'NOT_PASSED', label: 'Not Passed' }
] as const;

export function interviewStageLabel(v: string): string {
  return INTERVIEW_STAGES.find((s) => s.value === v)?.label ?? v;
}

export function interviewResultLabel(v: string): string {
  return INTERVIEW_RESULTS.find((r) => r.value === v)?.label ?? v;
}
