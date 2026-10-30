'use client';

import { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getApplyOptions, submitApplication, type ApplyOptions } from '@/lib/recruitment';

// Same rules as the backend: PDF or Word (DOC/DOCX), max 5 MB.
const CV_MAX_BYTES = 5 * 1024 * 1024;
const CV_EXTENSIONS = ['.pdf', '.doc', '.docx'];
const OPEN_APPLICATION = 'open';

const EMPLOYMENT_TYPES = [
  { value: 'FULL_TIME', label: 'Full-time' },
  { value: 'CONTRACT', label: 'Contract-based' },
  { value: 'FREELANCE', label: 'Freelance / Project-based' },
  { value: 'INTERNSHIP', label: 'Internship' },
  { value: 'OPEN', label: 'Open to Opportunities (Talent Pool)' }
];
const LOCATIONS = [
  { value: 'YOGYAKARTA', label: 'Yogyakarta' },
  { value: 'JAKARTA', label: 'Jakarta' },
  { value: 'OTHER', label: 'Other' },
  { value: 'FLEXIBLE', label: 'Flexible' }
];
const EMPLOYMENT_STATUSES = [
  { value: 'EMPLOYED', label: 'Employed' },
  { value: 'FREELANCE', label: 'Freelance' },
  { value: 'OPEN_TO_WORK', label: 'Open to Work' },
  { value: 'STUDENT', label: 'Student' },
  { value: 'FRESH_GRADUATE', label: 'Fresh Graduate' },
  { value: 'OTHER', label: 'Other' }
];
const AVAILABILITY = [
  { value: 'IMMEDIATELY', label: 'Immediately' },
  { value: '1_2_WEEKS', label: 'Within 1–2 Weeks' },
  { value: '2_4_WEEKS', label: 'Within 2–4 Weeks' },
  { value: 'OVER_1_MONTH', label: 'More Than 1 Month' },
  { value: 'DEPENDS', label: 'Depends on the Project / Schedule' }
];
const SOURCES = [
  { value: 'LINKEDIN', label: 'LinkedIn' },
  { value: 'JOBSTREET', label: 'JobStreet' },
  { value: 'THREADS', label: 'Threads' },
  { value: 'SOCIAL_MEDIA', label: 'Instagram / Social Media' },
  { value: 'REFERRAL', label: 'Employee / Professional Referral' },
  { value: 'WEBSITE', label: 'Feraco Website' },
  { value: 'OTHER', label: 'Other' }
];
const SALARY_TYPES = ['FULL_TIME', 'CONTRACT', 'INTERNSHIP'];

const selectClass = 'border-input h-9 w-full rounded-lg border bg-transparent px-2.5 text-sm';

function cvError(f: File): string | null {
  const name = f.name.toLowerCase();
  if (!CV_EXTENSIONS.some((ext) => name.endsWith(ext))) return 'CV must be a PDF or Word (DOC/DOCX) file.';
  if (f.size > CV_MAX_BYTES) return 'CV must be 5 MB or smaller.';
  return null;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className='space-y-3 border-t pt-5 first:border-t-0 first:pt-0'>
      <legend className='text-primary mb-1 text-xs font-semibold tracking-wide uppercase'>{title}</legend>
      {children}
    </fieldset>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className='space-y-1'>
      <Label className='text-xs'>
        {label}
        {required && <span className='text-destructive'> *</span>}
      </Label>
      {children}
    </div>
  );
}

function RadioGroup({
  name,
  options,
  value,
  onChange
}: {
  name: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className='grid gap-1.5 sm:grid-cols-2'>
      {options.map((o) => (
        <label key={o.value} className='flex cursor-pointer items-center gap-2 text-sm'>
          <input
            type='radio'
            name={name}
            value={o.value}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
            className='accent-primary size-4'
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}

/**
 * Feraco Recruitment & Talent Pool form (talentpool.md "Contoh form"): one
 * form for in-house and freelance candidates, for a vacancy or an Open
 * Application. `defaultJobId` preselects the vacancy (from /jobs/[slug]).
 */
export function ApplyForm({ defaultJobId = null }: { defaultJobId?: number | null }) {
  const [options, setOptions] = useState<ApplyOptions | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [ref, setRef] = useState('');
  const [cv, setCv] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [form, setForm] = useState({
    full_name: '',
    email: '',
    phone: '',
    city: '',
    linkedin_url: '',
    position: defaultJobId ? String(defaultJobId) : OPEN_APPLICATION,
    skill_id: '',
    employment_types: [] as string[],
    preferred_location: '',
    preferred_location_other: '',
    employment_status: '',
    employment_status_other: '',
    portfolio_url: '',
    availability: '',
    expected_monthly_salary: '',
    expected_project_fee: '',
    source_reported: '',
    source_other: ''
  });

  useEffect(() => {
    // Channel link (?ref=linkedin) -> internal recruitment source.
    setRef(new URLSearchParams(window.location.search).get('ref') ?? '');
    getApplyOptions()
      .then(setOptions)
      .catch(() => setLoadError(true));
  }, []);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));
  const selectedJob = options?.jobs.find((j) => String(j.id) === form.position) ?? null;
  const roles = selectedJob?.recruitment_type === 'FREELANCE' ? selectedJob.skills : [];
  const showSalary = form.employment_types.some((t) => SALARY_TYPES.includes(t));
  const showFee = form.employment_types.includes('FREELANCE');

  function toggleType(value: string, checked: boolean) {
    set('employment_types', checked ? [...form.employment_types, value] : form.employment_types.filter((t) => t !== value));
  }

  function missingField(): string | null {
    if (!form.full_name.trim() || !form.email.trim() || !form.phone.trim() || !form.city.trim())
      return 'Please complete your personal information.';
    if (roles.length > 0 && !form.skill_id) return 'Please choose the role you are applying for.';
    if (form.employment_types.length === 0) return 'Please choose at least one employment type.';
    if (!form.preferred_location || (form.preferred_location === 'OTHER' && !form.preferred_location_other.trim()))
      return 'Please choose your preferred work location.';
    if (!form.employment_status || (form.employment_status === 'OTHER' && !form.employment_status_other.trim()))
      return 'Please choose your current employment status.';
    if (!cv) return 'Please upload your CV.';
    if (!form.availability) return 'Please tell us when you can start.';
    if (!form.source_reported || (form.source_reported === 'OTHER' && !form.source_other.trim()))
      return 'Please tell us how you heard about this opportunity.';
    if (!consent) return 'Please give your consent to submit the application.';
    return null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const problem = missingField() ?? (cv ? cvError(cv) : null);
    if (problem) {
      toast.error(problem);
      return;
    }
    const fd = new FormData();
    const text: (keyof typeof form)[] = [
      'full_name', 'email', 'phone', 'city', 'linkedin_url', 'preferred_location', 'preferred_location_other',
      'employment_status', 'employment_status_other', 'portfolio_url', 'availability', 'source_reported', 'source_other'
    ];
    for (const key of text) fd.append(key, String(form[key]).trim());
    for (const t of form.employment_types) fd.append('employment_types', t);
    if (form.position !== OPEN_APPLICATION) fd.append('job', form.position);
    if (roles.length > 0) fd.append('skill_id', form.skill_id);
    if (showSalary && form.expected_monthly_salary) fd.append('expected_monthly_salary', form.expected_monthly_salary);
    if (showFee && form.expected_project_fee) fd.append('expected_project_fee', form.expected_project_fee);
    if (ref) fd.append('ref', ref);
    fd.append('consent', 'true');
    fd.append('cv', cv as File);
    setSubmitting(true);
    try {
      await submitApplication(fd);
      setDone(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to submit the application.');
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <p className='text-primary py-6 text-center text-sm font-medium'>
        Thank you! Your application has been submitted. Our HR team will contact you if your profile matches our needs.
      </p>
    );
  }
  if (loadError) {
    return <p className='text-muted-foreground py-6 text-center text-sm'>The form is unavailable right now. Please try again later.</p>;
  }
  if (!options) {
    return <p className='text-muted-foreground py-6 text-center text-sm'>Loading form…</p>;
  }

  return (
    <form onSubmit={submit} className='space-y-5'>
      <Section title='1 · Personal Information'>
        <Field label='Full Name' required>
          <Input value={form.full_name} onChange={(e) => set('full_name', e.target.value)} />
        </Field>
        <div className='grid gap-3 sm:grid-cols-2'>
          <Field label='Email Address' required>
            <Input type='email' value={form.email} onChange={(e) => set('email', e.target.value)} />
          </Field>
          <Field label='Phone Number / WhatsApp' required>
            <Input value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder='08xx' />
          </Field>
          <Field label='Current City of Residence' required>
            <Input value={form.city} onChange={(e) => set('city', e.target.value)} />
          </Field>
          <Field label='LinkedIn Profile'>
            <Input type='url' value={form.linkedin_url} onChange={(e) => set('linkedin_url', e.target.value)} placeholder='https://linkedin.com/in/…' />
          </Field>
        </div>
      </Section>

      <Section title='2 · Application Details'>
        <Field label='Position Applied For' required>
          <select
            className={selectClass}
            value={form.position}
            onChange={(e) => setForm((f) => ({ ...f, position: e.target.value, skill_id: '' }))}
          >
            <option value={OPEN_APPLICATION}>Open Application / Talent Pool</option>
            {options.jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.title}
                {j.location ? ` · ${j.location}` : ''}
              </option>
            ))}
          </select>
        </Field>
        {roles.length > 0 && (
          <Field label='Role' required>
            <select className={selectClass} value={form.skill_id} onChange={(e) => set('skill_id', e.target.value)}>
              <option value=''>Choose a role</option>
              {roles.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.category ? `${s.category} · ` : ''}
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label='Employment Type (choose one or more)' required>
          <div className='grid gap-1.5 sm:grid-cols-2'>
            {EMPLOYMENT_TYPES.map((t) => (
              <label key={t.value} className='flex cursor-pointer items-center gap-2 text-sm'>
                <Checkbox
                  checked={form.employment_types.includes(t.value)}
                  onCheckedChange={(checked) => toggleType(t.value, checked === true)}
                />
                {t.label}
              </label>
            ))}
          </div>
        </Field>
        <Field label='Preferred Work Location' required>
          <RadioGroup name='preferred_location' options={LOCATIONS} value={form.preferred_location} onChange={(v) => set('preferred_location', v)} />
          {form.preferred_location === 'OTHER' && (
            <Input
              className='mt-2'
              placeholder='Please specify'
              value={form.preferred_location_other}
              onChange={(e) => set('preferred_location_other', e.target.value)}
            />
          )}
        </Field>
      </Section>

      <Section title='3 · Professional Background'>
        <Field label='Current Employment Status' required>
          <RadioGroup
            name='employment_status'
            options={EMPLOYMENT_STATUSES}
            value={form.employment_status}
            onChange={(v) => set('employment_status', v)}
          />
          {form.employment_status === 'OTHER' && (
            <Input
              className='mt-2'
              placeholder='Please specify'
              value={form.employment_status_other}
              onChange={(e) => set('employment_status_other', e.target.value)}
            />
          )}
        </Field>
        <Field label='CV / Resume' required>
          <Input
            type='file'
            accept='.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            onChange={(e) => {
              const picked = e.target.files?.[0] || null;
              const problem = picked ? cvError(picked) : null;
              if (problem) {
                toast.error(problem);
                e.target.value = '';
                setCv(null);
                return;
              }
              setCv(picked);
            }}
          />
          <p className='text-muted-foreground text-xs'>PDF / DOC / DOCX, max. 5 MB</p>
        </Field>
        <Field label='Portfolio / Work Samples Link'>
          <Input
            type='url'
            value={form.portfolio_url}
            onChange={(e) => set('portfolio_url', e.target.value)}
            placeholder='Google Drive, Behance, website, …'
          />
        </Field>
      </Section>

      <Section title='4 · Availability'>
        <Field label='When Can You Start?' required>
          <RadioGroup name='availability' options={AVAILABILITY} value={form.availability} onChange={(v) => set('availability', v)} />
        </Field>
      </Section>

      <Section title='5 · Additional Information'>
        {(showSalary || showFee) && (
          <div className='grid gap-3 sm:grid-cols-2'>
            {showSalary && (
              <Field label='Expected Monthly Salary (IDR, optional)'>
                <Input
                  type='number'
                  min={0}
                  inputMode='numeric'
                  value={form.expected_monthly_salary}
                  onChange={(e) => set('expected_monthly_salary', e.target.value)}
                />
              </Field>
            )}
            {showFee && (
              <Field label='Expected Project Fee / Daily Rate (IDR, optional)'>
                <Input
                  type='number'
                  min={0}
                  inputMode='numeric'
                  value={form.expected_project_fee}
                  onChange={(e) => set('expected_project_fee', e.target.value)}
                />
              </Field>
            )}
          </div>
        )}
        <Field label='How Did You Hear About Feraco / This Opportunity?' required>
          <select className={selectClass} value={form.source_reported} onChange={(e) => set('source_reported', e.target.value)}>
            <option value=''>Choose one</option>
            {SOURCES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          {form.source_reported === 'OTHER' && (
            <Input className='mt-2' placeholder='Please specify' value={form.source_other} onChange={(e) => set('source_other', e.target.value)} />
          )}
        </Field>
      </Section>

      <Section title='Personal Data Consent'>
        <label className='flex cursor-pointer items-start gap-2 text-sm'>
          <Checkbox className='mt-0.5' checked={consent} onCheckedChange={(checked) => setConsent(checked === true)} />
          <span>
            {options.consent_text}
            <span className='text-destructive'> *</span>
          </span>
        </label>
      </Section>

      <Button type='submit' disabled={submitting} className='w-full sm:w-auto'>
        {submitting ? 'Submitting…' : 'Submit Application'}
      </Button>
    </form>
  );
}
