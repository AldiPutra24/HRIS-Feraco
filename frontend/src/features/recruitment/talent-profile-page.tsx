'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { notFound, useRouter } from 'next/navigation';
import { toast } from 'react-toastify';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Icons } from '@/components/icons';
import {
  anonymizeTalentProfile,
  createProfileApplication,
  getTalentProfile,
  listJobs,
  markNotDuplicate,
  mergeTalentProfile,
  profileCvFileUrl,
  updateTalentProfile,
  type Job,
  type TalentProfileDetail,
  type TalentProfileInput
} from '@/lib/recruitment';
import { inactiveReasonLabel, statusLabel } from '@/features/recruitment/candidate-pipeline';
import {
  AVAILABILITY_LABELS,
  EMPLOYMENT_STATUS_LABELS,
  EMPLOYMENT_TYPE_LABELS,
  LOCATION_LABELS,
  SOURCE_REPORTED_LABELS,
  TRACK_LABELS,
  label
} from '@/features/recruitment/talent-pool-labels';
import { useAuth } from '@/lib/auth/auth-provider';

const selectClass = 'border-input h-9 w-full rounded-lg border bg-transparent px-2.5 text-sm';

function fmtDate(v: string | null): string {
  return v ? new Date(v).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';
}

function fmtMoney(v: string | null): string {
  return v ? `Rp ${Number(v).toLocaleString('id-ID')}` : '-';
}

function Field({ label: title, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className='text-muted-foreground text-xs'>{title}</p>
      <p className='text-sm font-medium break-words'>{value || '-'}</p>
    </div>
  );
}

function toInput(p: TalentProfileDetail): TalentProfileInput {
  return {
    full_name: p.full_name,
    phone: p.phone,
    city: p.city,
    linkedin_url: p.linkedin_url,
    portfolio_url: p.portfolio_url,
    preferred_location: p.preferred_location,
    employment_status: p.employment_status,
    availability: p.availability,
    expected_monthly_salary: p.expected_monthly_salary,
    expected_project_fee: p.expected_project_fee
  };
}

/** Talent Pool profile: person data, applications, duplicates, privacy. */
export function TalentProfilePage({ id }: { id: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const canAnonymize = user?.role === 'admin' || user?.role === 'hr_lead';
  const [profile, setProfile] = useState<TalentProfileDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<TalentProfileInput>({});
  const [jobs, setJobs] = useState<Job[]>([]);
  const [newJob, setNewJob] = useState('');

  function load() {
    getTalentProfile(Number(id))
      .then((p) => {
        setProfile(p);
        setDraft(toInput(p));
      })
      .catch(() => setMissing(true));
  }

  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    listJobs({ status: 'OPEN' })
      .then(setJobs)
      .catch(() => setJobs([]));
  }, []);

  if (missing) notFound();

  async function run<T>(action: () => Promise<T>, success: string, after?: (r: T) => void) {
    setBusy(true);
    try {
      const result = await action();
      toast.success(success);
      if (after) after(result);
      else load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan.');
    } finally {
      setBusy(false);
    }
  }

  if (!profile) {
    return (
      <div className='space-y-2 p-4 md:p-6'>
        <Skeleton className='h-8 w-64' />
        <Skeleton className='h-40 w-full' />
      </div>
    );
  }

  const p = profile;
  const anonymized = !!p.anonymized_at;
  const set = <K extends keyof TalentProfileInput>(k: K, v: TalentProfileInput[K]) => setDraft((d) => ({ ...d, [k]: v }));

  return (
    <div className='flex flex-1 flex-col gap-4 p-4 md:p-6'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>{p.full_name}</h2>
          <p className='text-muted-foreground text-sm'>
            {p.code} · Terdaftar {fmtDate(p.created_at)} · Diperbarui {fmtDate(p.updated_at)}
          </p>
          <div className='mt-2 flex flex-wrap gap-1'>
            {p.freelancer && <Badge variant='secondary'>Freelancer</Badge>}
            {p.employee && (
              <Link href={`/dashboard/karyawan/${p.employee}`}>
                <Badge variant='secondary'>Karyawan →</Badge>
              </Link>
            )}
            {anonymized && <Badge variant='outline'>Dianonimkan {fmtDate(p.anonymized_at)}</Badge>}
          </div>
        </div>
        <div className='flex gap-2'>
          {!anonymized && !editing && (
            <Button size='sm' variant='outline' onClick={() => setEditing(true)}>
              <Icons.edit className='size-4' /> Edit
            </Button>
          )}
          <Button variant='ghost' onClick={() => router.back()}>
            Kembali
          </Button>
        </div>
      </div>

      {p.possible_duplicate_of && p.possible_duplicate_code && (
        <Card className='border-amber-300'>
          <CardHeader>
            <CardTitle>Kemungkinan duplikat</CardTitle>
            <CardDescription>
              Nomor telepon profil ini sama dengan{' '}
              <Link href={`/dashboard/recruitment/talent-pool/${p.possible_duplicate_of}`} className='text-primary font-medium hover:underline'>
                {p.possible_duplicate_code}
              </Link>
              , tetapi emailnya berbeda.
            </CardDescription>
          </CardHeader>
          <CardContent className='flex flex-wrap gap-2'>
            <Button
              size='sm'
              disabled={busy}
              onClick={() => {
                if (!window.confirm(`Gabungkan ${p.code} ke ${p.possible_duplicate_code}? Semua lamaran dipindah dan profil ini dihapus.`)) return;
                const target = p.possible_duplicate_of as number;
                void run(() => mergeTalentProfile(p.id, target), 'Profil digabung.', () =>
                  router.replace(`/dashboard/recruitment/talent-pool/${target}`)
                );
              }}
            >
              Gabungkan ke {p.possible_duplicate_code}
            </Button>
            <Button size='sm' variant='outline' disabled={busy} onClick={() => void run(() => markNotDuplicate(p.id), 'Ditandai bukan duplikat.')}>
              Bukan duplikat
            </Button>
          </CardContent>
        </Card>
      )}

      <div className='grid gap-4 lg:grid-cols-3'>
        <Card className='lg:col-span-2'>
          <CardHeader>
            <CardTitle>Profil</CardTitle>
          </CardHeader>
          {editing ? (
            <CardContent className='grid gap-3 md:grid-cols-2'>
              {(
                [
                  ['full_name', 'Nama Lengkap'],
                  ['phone', 'Telepon / WhatsApp'],
                  ['city', 'Kota Domisili'],
                  ['linkedin_url', 'LinkedIn'],
                  ['portfolio_url', 'Portfolio']
                ] as const
              ).map(([k, t]) => (
                <div key={k}>
                  <Label className='text-xs'>{t}</Label>
                  <Input value={(draft[k] as string) ?? ''} onChange={(e) => set(k, e.target.value)} />
                </div>
              ))}
              {(
                [
                  ['preferred_location', 'Lokasi Kerja', LOCATION_LABELS],
                  ['employment_status', 'Status Pekerjaan', EMPLOYMENT_STATUS_LABELS],
                  ['availability', 'Availability', AVAILABILITY_LABELS]
                ] as const
              ).map(([k, t, opts]) => (
                <div key={k}>
                  <Label className='text-xs'>{t}</Label>
                  <select className={selectClass} value={(draft[k] as string) ?? ''} onChange={(e) => set(k, e.target.value)}>
                    <option value=''>-</option>
                    {Object.entries(opts).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
              {(
                [
                  ['expected_monthly_salary', 'Ekspektasi Gaji Bulanan'],
                  ['expected_project_fee', 'Ekspektasi Fee Proyek / Harian']
                ] as const
              ).map(([k, t]) => (
                <div key={k}>
                  <Label className='text-xs'>{t}</Label>
                  <Input
                    type='number'
                    min={0}
                    value={draft[k] ?? ''}
                    onChange={(e) => set(k, e.target.value === '' ? null : e.target.value)}
                  />
                </div>
              ))}
              <div className='flex gap-2 md:col-span-2'>
                <Button
                  size='sm'
                  disabled={busy}
                  onClick={() =>
                    void run(() => updateTalentProfile(p.id, draft), 'Profil disimpan.', () => {
                      setEditing(false);
                      load();
                    })
                  }
                >
                  Simpan
                </Button>
                <Button
                  size='sm'
                  variant='ghost'
                  onClick={() => {
                    setDraft(toInput(p));
                    setEditing(false);
                  }}
                >
                  Batal
                </Button>
              </div>
            </CardContent>
          ) : (
            <CardContent className='grid gap-4 md:grid-cols-2'>
              <Field label='Email' value={p.email} />
              <Field label='Telepon / WhatsApp' value={p.phone} />
              <Field label='Kota Domisili' value={p.city} />
              <Field
                label='Lokasi Kerja'
                value={`${label(LOCATION_LABELS, p.preferred_location)}${p.preferred_location_other ? ` (${p.preferred_location_other})` : ''}`}
              />
              <Field label='Employment Type' value={p.employment_types.map((t) => label(EMPLOYMENT_TYPE_LABELS, t)).join(', ')} />
              <Field
                label='Status Pekerjaan'
                value={`${label(EMPLOYMENT_STATUS_LABELS, p.employment_status)}${p.employment_status_other ? ` (${p.employment_status_other})` : ''}`}
              />
              <Field label='Availability' value={label(AVAILABILITY_LABELS, p.availability)} />
              <Field
                label='Sumber (jawaban kandidat)'
                value={`${label(SOURCE_REPORTED_LABELS, p.source_reported)}${p.source_other ? ` (${p.source_other})` : ''}`}
              />
              <Field label='Ekspektasi Gaji Bulanan' value={fmtMoney(p.expected_monthly_salary)} />
              <Field label='Ekspektasi Fee Proyek / Harian' value={fmtMoney(p.expected_project_fee)} />
              <Field
                label='LinkedIn'
                value={p.linkedin_url && <a href={p.linkedin_url} target='_blank' rel='noreferrer' className='text-primary hover:underline'>{p.linkedin_url}</a>}
              />
              <Field
                label='Portfolio'
                value={p.portfolio_url && <a href={p.portfolio_url} target='_blank' rel='noreferrer' className='text-primary hover:underline'>{p.portfolio_url}</a>}
              />
            </CardContent>
          )}
        </Card>

        <div className='space-y-4'>
          <Card>
            <CardHeader>
              <CardTitle>CV Terbaru</CardTitle>
            </CardHeader>
            <CardContent>
              {p.cv_url ? (
                <a
                  href={profileCvFileUrl(p) ?? undefined}
                  target='_blank'
                  rel='noreferrer'
                  className='text-primary inline-flex items-center gap-1 text-sm font-medium hover:underline'
                >
                  <Icons.paperclip className='size-4' />
                  {p.cv_name || 'CV'}
                </a>
              ) : (
                <p className='text-muted-foreground text-sm'>Tidak ada CV.</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Privasi &amp; Consent</CardTitle>
              <CardDescription>
                {p.consent_at
                  ? `Consent ${fmtDate(p.consent_at)} (${p.consent_version})`
                  : p.consent_version === 'legacy'
                    ? 'Data lama — consent belum tercatat.'
                    : 'Consent belum tercatat.'}
              </CardDescription>
            </CardHeader>
            {canAnonymize && !anonymized && (
              <CardContent>
                <Button
                  size='sm'
                  variant='destructive'
                  disabled={busy}
                  onClick={() => {
                    if (!window.confirm(`Anonimkan ${p.code}? Data pribadi dan CV dihapus permanen; status lamaran tetap untuk statistik.`)) return;
                    void run(() => anonymizeTalentProfile(p.id), 'Profil dianonimkan.');
                  }}
                >
                  Anonimkan (tarik consent)
                </Button>
              </CardContent>
            )}
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Lamaran ({p.applications.length})</CardTitle>
          <CardDescription>Setiap lamaran punya status dan hasil seleksinya sendiri.</CardDescription>
        </CardHeader>
        <CardContent className='space-y-3'>
          <div className='divide-y rounded-lg border'>
            {p.applications.map((a) => (
              <Link
                key={a.id}
                href={`/dashboard/recruitment/candidates/${a.id}`}
                className='hover:bg-muted/40 flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm'
              >
                <div>
                  <p className='font-medium'>{a.job_title ?? 'Open Application'}</p>
                  <p className='text-muted-foreground text-xs'>
                    {label(TRACK_LABELS, a.track)} · {fmtDate(a.created_at)}
                  </p>
                </div>
                <div className='text-right'>
                  <Badge variant={a.status === 'INACTIVE' ? 'outline' : 'default'}>{statusLabel(a.status)}</Badge>
                  {a.status === 'INACTIVE' && a.inactive_reason && (
                    <p className='text-muted-foreground mt-0.5 text-xs'>{inactiveReasonLabel(a.inactive_reason)}</p>
                  )}
                </div>
              </Link>
            ))}
          </div>
          {!anonymized && (
            <div className='flex flex-wrap items-center gap-2'>
              <select className={`${selectClass} max-w-72`} value={newJob} onChange={(e) => setNewJob(e.target.value)}>
                <option value=''>Open Application (tanpa lowongan)</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.title} · {j.recruitment_type === 'FREELANCE' ? 'Freelance' : 'Inhouse'}
                  </option>
                ))}
              </select>
              <Button
                size='sm'
                variant='outline'
                disabled={busy}
                onClick={() =>
                  void run(
                    () => createProfileApplication(p.id, newJob ? Number(newJob) : null),
                    'Lamaran baru dibuat.',
                    (app) => router.push(`/dashboard/recruitment/candidates/${app.id}`)
                  )
                }
              >
                <Icons.plus className='size-4' /> Pertimbangkan untuk posisi ini
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
