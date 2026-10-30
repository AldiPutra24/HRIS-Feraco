/** Labels for Talent Pool profile choices (backend CandidateProfile choices). */
export const EMPLOYMENT_TYPE_LABELS: Record<string, string> = {
  FULL_TIME: 'Full-time',
  CONTRACT: 'Contract-based',
  FREELANCE: 'Freelance / Project-based',
  INTERNSHIP: 'Internship',
  OPEN: 'Open to Opportunities'
};

export const LOCATION_LABELS: Record<string, string> = {
  YOGYAKARTA: 'Yogyakarta',
  JAKARTA: 'Jakarta',
  OTHER: 'Other',
  FLEXIBLE: 'Flexible'
};

export const EMPLOYMENT_STATUS_LABELS: Record<string, string> = {
  EMPLOYED: 'Employed',
  FREELANCE: 'Freelance',
  OPEN_TO_WORK: 'Open to Work',
  STUDENT: 'Student',
  FRESH_GRADUATE: 'Fresh Graduate',
  OTHER: 'Other'
};

export const AVAILABILITY_LABELS: Record<string, string> = {
  IMMEDIATELY: 'Immediately',
  '1_2_WEEKS': 'Within 1–2 Weeks',
  '2_4_WEEKS': 'Within 2–4 Weeks',
  OVER_1_MONTH: 'More Than 1 Month',
  DEPENDS: 'Depends on the Project / Schedule'
};

export const SOURCE_REPORTED_LABELS: Record<string, string> = {
  LINKEDIN: 'LinkedIn',
  JOBSTREET: 'JobStreet',
  THREADS: 'Threads',
  SOCIAL_MEDIA: 'Instagram / Social Media',
  REFERRAL: 'Employee / Professional Referral',
  WEBSITE: 'Feraco Website',
  OTHER: 'Other'
};

export const TRACK_LABELS: Record<string, string> = {
  INHOUSE: 'Inhouse',
  FREELANCE: 'Freelance',
  UNDECIDED: 'Belum ditentukan'
};

export function label(map: Record<string, string>, v: string | null | undefined): string {
  return v ? (map[v] ?? v) : '-';
}
