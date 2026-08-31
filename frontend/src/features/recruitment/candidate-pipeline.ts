export const PIPELINE = [
  'APPLIED',
  'SCREENING',
  'INTERVIEW_HR',
  'INTERVIEW_USER',
  'INTERVIEW_GM',
  'OFFERING',
  'OFFER_ACCEPTED'
] as const;

export const ALL_STATUSES = [
  ...PIPELINE,
  'REJECTED',
  'WITHDRAWN'
] as const;

export type CandidateStatus = (typeof ALL_STATUSES)[number];

export function statusLabel(v: string): string {
  return v.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
