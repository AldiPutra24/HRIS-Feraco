'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { notFound, useRouter } from 'next/navigation';
import { toast } from 'react-toastify';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Icons } from '@/components/icons';
import {
  acceptCandidateFreelance,
  candidateCvFileUrl,
  createInterview,
  deleteInterview,
  getCandidate,
  hardDeleteCandidate,
  screenCandidate,
  transitionCandidate,
  updateInterview,
  type Candidate
} from '@/lib/recruitment';
import {
  INACTIVE_REASONS,
  INTERVIEW_RESULTS,
  INTERVIEW_STAGES,
  PIPELINE,
  SCREENING_RESULT_LABELS,
  inactiveReasonLabel,
  interviewResultLabel,
  interviewStageLabel,
  statusLabel
} from '@/features/recruitment/candidate-pipeline';
import { useAuth } from '@/lib/auth/auth-provider';

const inputClass = 'border-input h-9 w-full rounded-lg border bg-transparent px-2.5 text-sm';
const textareaClass = 'border-input min-h-20 w-full rounded-lg border bg-transparent px-2.5 py-2 text-sm';

function sourceLabel(v: string): string {
  return v.replace('_', ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function fmtDateTime(v: string | null): string {
  if (!v) return '-';
  return new Date(v).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className='text-muted-foreground text-xs'>{label}</p>
      <p className='text-sm font-medium'>{value}</p>
    </div>
  );
}

function PipelineSteps({ current }: { current: string }) {
  const idx = PIPELINE.indexOf(current as (typeof PIPELINE)[number]);
  return (
    <div className='flex items-center gap-0 overflow-x-auto'>
      {PIPELINE.map((s, i) => {
        const done = idx >= i;
        const active = idx === i;
        return (
          <div key={s} className='flex min-w-0 items-center'>
            <div
              className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap ${
                active
                  ? 'bg-primary text-primary-foreground ring-primary/30 ring-2'
                  : done
                    ? 'bg-primary/10 text-primary'
                    : 'bg-muted text-muted-foreground'
              }`}
            >
              {statusLabel(s)}
            </div>
            {i < PIPELINE.length - 1 && (
              <div className={`mx-1 h-px w-6 flex-1 ${idx > i ? 'bg-primary' : 'bg-muted-foreground/20'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function resultVariant(result: string): 'default' | 'secondary' | 'outline' {
  if (result === 'PASSED') return 'default';
  if (result === 'NOT_PASSED') return 'outline';
  return 'secondary';
}

export function RecruitmentCandidateDetailPage({ id }: { id: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [notFoundState, setNotFoundState] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [inactiveReason, setInactiveReason] = useState('');
  const [screenResult, setScreenResult] = useState('');
  const [screenNotes, setScreenNotes] = useState('');
  const [iv, setIv] = useState({ stage: 'HR', scheduled_at: '', interviewer_name: '', notes: '' });

  function load() {
    setLoading(true);
    getCandidate(Number(id))
      .then((c) => {
        setCandidate(c);
        setNote('');
        setInactiveReason('');
        setScreenResult(c.screening_result);
        setScreenNotes(c.screening_notes);
      })
      .catch(() => setNotFoundState(true))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (notFoundState) notFound();

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan.');
    } finally {
      setBusy(false);
    }
  }

  function handleTransition(toStatus: string) {
    if (!candidate) return;
    const reason = toStatus === 'INACTIVE' ? inactiveReason : '';
    void run(() => transitionCandidate(candidate.id, toStatus, note, reason), `Status diubah ke ${statusLabel(toStatus)}`);
  }

  function handleScreening() {
    if (!candidate) return;
    void run(() => screenCandidate(candidate.id, screenResult, screenNotes), 'Hasil screening disimpan.');
  }

  function handleAddInterview() {
    if (!candidate) return;
    void run(async () => {
      await createInterview({
        application: candidate.id,
        stage: iv.stage,
        scheduled_at: iv.scheduled_at ? new Date(iv.scheduled_at).toISOString() : null,
        interviewer_name: iv.interviewer_name,
        result: 'PENDING',
        notes: iv.notes
      });
      setIv({ stage: 'HR', scheduled_at: '', interviewer_name: '', notes: '' });
    }, 'Interview dicatat.');
  }

  async function handleAcceptFreelance() {
    if (!candidate) return;
    setBusy(true);
    try {
      await acceptCandidateFreelance(candidate.id);
      toast.success('Kandidat diterima sebagai Freelancer.');
      router.push('/dashboard/freelance');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menerima kandidat.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!candidate) return;
    if (!window.confirm(`Hapus permanen kandidat "${candidate.full_name}"? Tidak dapat dibatalkan.`)) return;
    try {
      await hardDeleteCandidate(candidate.id);
      toast.success('Kandidat dihapus permanen.');
      router.push('/dashboard/recruitment/candidates');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menghapus kandidat.');
    }
  }

  if (loading && !candidate) {
    return (
      <div className='space-y-2 p-4 md:p-6'>
        <Skeleton className='h-8 w-64' />
        <Skeleton className='h-40 w-full' />
      </div>
    );
  }

  if (!candidate) return null;

  const isFreelance = candidate.track === 'FREELANCE';
  const isInactive = candidate.status === 'INACTIVE';
  const alreadyFreelancer = candidate.talent_pool_freelancer_id != null;
  const forwardNext = candidate.next_statuses.filter((s) => s !== 'INACTIVE');
  const canInactivate = candidate.next_statuses.includes('INACTIVE');

  return (
    <div className='flex flex-1 flex-col gap-4 p-4 md:p-6'>
      <div className='flex items-center justify-between gap-3'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>{candidate.full_name}</h2>
          <p className='text-muted-foreground text-sm'>
            Detail lamaran · {candidate.profile_code} · {isFreelance ? 'Freelance' : candidate.track === 'INHOUSE' ? 'Inhouse' : 'Belum ditentukan'}
          </p>
        </div>
        <div className='flex items-center gap-2'>
          {isAdmin && (
            <Button variant='destructive' size='sm' onClick={() => handleDelete()}>
              Hapus Permanen
            </Button>
          )}
          <Button variant='ghost' onClick={() => router.back()}>
            Kembali
          </Button>
        </div>
      </div>

      {/* Pipeline (PRD 5.5) */}
      <Card>
        <CardHeader>
          <CardTitle>Pipeline</CardTitle>
          <CardDescription>
            Status saat ini: <Badge variant={isInactive ? 'outline' : 'default'}>{statusLabel(candidate.status)}</Badge>
            {candidate.legacy_status && (
              <span className='ml-2 text-xs'>(status lama: {statusLabel(candidate.legacy_status)})</span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <PipelineSteps current={candidate.status} />

          {isInactive && (
            <div className='rounded-lg border border-dashed p-3 text-sm'>
              <p>
                Alasan: <span className='font-medium'>{inactiveReasonLabel(candidate.inactive_reason) || '-'}</span>
              </p>
              {candidate.inactive_note && <p className='text-muted-foreground mt-0.5 text-xs'>{candidate.inactive_note}</p>}
            </div>
          )}

          {candidate.next_statuses.length > 0 && (
            <div className='space-y-3 rounded-lg border p-3'>
              <p className='text-muted-foreground text-xs font-medium'>{isInactive ? 'Aktifkan kembali' : 'Ubah Status'}</p>
              {forwardNext.length > 0 && (
                <div className='flex flex-wrap gap-2'>
                  {forwardNext.map((s) => (
                    <Button
                      key={s}
                      size='sm'
                      disabled={busy || (s === 'SCREENED' && !candidate.screening_result)}
                      title={s === 'SCREENED' && !candidate.screening_result ? 'Isi hasil screening dulu' : undefined}
                      onClick={() => handleTransition(s)}
                    >
                      {statusLabel(s)}
                    </Button>
                  ))}
                  {isFreelance && !isInactive && !alreadyFreelancer && (
                    <Button size='sm' variant='secondary' disabled={busy} onClick={handleAcceptFreelance}>
                      Terima sebagai Freelancer
                    </Button>
                  )}
                </div>
              )}
              {canInactivate && (
                <div className='flex flex-wrap items-center gap-2'>
                  <select
                    className={`${inputClass} max-w-56`}
                    value={inactiveReason}
                    onChange={(e) => setInactiveReason(e.target.value)}
                  >
                    <option value=''>Pilih alasan Inactive…</option>
                    {INACTIVE_REASONS.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                  <Button
                    size='sm'
                    variant='destructive'
                    disabled={busy || !inactiveReason || (inactiveReason === 'OTHER' && !note.trim())}
                    onClick={() => handleTransition('INACTIVE')}
                  >
                    Tandai Inactive
                  </Button>
                </div>
              )}
              <div>
                <p className='text-muted-foreground mb-1 text-xs'>
                  Catatan {inactiveReason === 'OTHER' ? '(wajib untuk alasan Other)' : '(opsional)'}
                </p>
                <input
                  className={`${inputClass} max-w-md`}
                  placeholder='Alasan perubahan status...'
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
            </div>
          )}

          {candidate.status === 'HIRED' && (
            <div className='flex flex-wrap items-center gap-2 text-sm'>
              {isFreelance ? (
                <Badge variant='secondary'>{alreadyFreelancer ? 'Sudah jadi Freelancer' : 'Hired'}</Badge>
              ) : (
                <Link href='/dashboard/recruitment/onboarding' className='text-primary font-medium hover:underline'>
                  Lanjut ke Onboarding →
                </Link>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Screening */}
      <Card>
        <CardHeader>
          <CardTitle>Screening</CardTitle>
          <CardDescription>
            {candidate.screening_result
              ? `${SCREENING_RESULT_LABELS[candidate.screening_result]} · ${candidate.screened_by_name ?? '-'} · ${fmtDateTime(candidate.screened_at)}`
              : 'Belum ada hasil screening.'}
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-3'>
          {candidate.screening_notes && (
            <p className='rounded-lg border p-3 text-sm whitespace-pre-line'>{candidate.screening_notes}</p>
          )}
          {!isInactive && (
            <div className='grid gap-2 md:max-w-xl'>
              <select className={inputClass} value={screenResult} onChange={(e) => setScreenResult(e.target.value)}>
                <option value=''>Hasil screening…</option>
                {Object.entries(SCREENING_RESULT_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
              <textarea
                className={textareaClass}
                placeholder='Catatan screening (wajib)'
                value={screenNotes}
                onChange={(e) => setScreenNotes(e.target.value)}
              />
              <div>
                <Button size='sm' disabled={busy || !screenResult || !screenNotes.trim()} onClick={handleScreening}>
                  Simpan Screening
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Interviews */}
      <Card>
        <CardHeader>
          <CardTitle>Interview &amp; Skill Test</CardTitle>
          <CardDescription>Jadwal, interviewer, dan hasil evaluasi.</CardDescription>
        </CardHeader>
        <CardContent className='space-y-3'>
          {candidate.interviews.length === 0 ? (
            <p className='text-muted-foreground text-sm'>Belum ada interview.</p>
          ) : (
            <div className='space-y-2'>
              {candidate.interviews.map((i) => (
                <div key={i.id} className='flex flex-wrap items-start gap-3 rounded-lg border p-3 text-sm'>
                  <div className='min-w-0 flex-1'>
                    <p className='font-medium'>
                      {interviewStageLabel(i.stage)} · {fmtDateTime(i.scheduled_at)}
                    </p>
                    <p className='text-muted-foreground text-xs'>Interviewer: {i.interviewer_label ?? '-'}</p>
                    {i.notes && <p className='text-muted-foreground mt-1 text-xs whitespace-pre-line'>{i.notes}</p>}
                  </div>
                  <div className='flex shrink-0 items-center gap-2'>
                    <Badge variant={resultVariant(i.result)}>{interviewResultLabel(i.result)}</Badge>
                    <select
                      className='border-input h-8 rounded-lg border bg-transparent px-2 text-xs'
                      value={i.result}
                      disabled={busy}
                      aria-label='Ubah hasil interview'
                      onChange={(e) => void run(() => updateInterview(i.id, { result: e.target.value }), 'Hasil interview diperbarui.')}
                    >
                      {INTERVIEW_RESULTS.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                    <Button
                      size='sm'
                      variant='ghost'
                      disabled={busy}
                      aria-label='Hapus interview'
                      onClick={() => {
                        if (window.confirm('Hapus interview ini?')) void run(() => deleteInterview(i.id), 'Interview dihapus.');
                      }}
                    >
                      <Icons.trash className='size-4' />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!isInactive && (
            <div className='grid gap-2 rounded-lg border border-dashed p-3 md:grid-cols-3'>
              <select className={inputClass} value={iv.stage} onChange={(e) => setIv({ ...iv, stage: e.target.value })}>
                {INTERVIEW_STAGES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
              <input
                type='datetime-local'
                className={inputClass}
                value={iv.scheduled_at}
                onChange={(e) => setIv({ ...iv, scheduled_at: e.target.value })}
              />
              <input
                className={inputClass}
                placeholder='Nama interviewer'
                value={iv.interviewer_name}
                onChange={(e) => setIv({ ...iv, interviewer_name: e.target.value })}
              />
              <textarea
                className={`${textareaClass} md:col-span-3`}
                placeholder='Catatan (opsional)'
                value={iv.notes}
                onChange={(e) => setIv({ ...iv, notes: e.target.value })}
              />
              <div className='md:col-span-3'>
                <Button size='sm' disabled={busy || !iv.interviewer_name.trim()} onClick={handleAddInterview}>
                  Tambah Interview
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Profile */}
      <Card>
        <CardHeader>
          <CardTitle>Profil Kandidat</CardTitle>
          <CardDescription>
            {candidate.job_title}
            {candidate.source ? ` · ${sourceLabel(candidate.source)}` : ''}
          </CardDescription>
        </CardHeader>
        <CardContent className='grid grid-cols-1 gap-4 md:grid-cols-2'>
          <Field label='Nama Lengkap' value={candidate.full_name} />
          <Field label='Email' value={candidate.email} />
          <Field label='Telepon' value={candidate.phone || '-'} />
          <Field label='Lowongan' value={candidate.job_title} />
          <Field label='Kategori' value={isFreelance ? 'Freelance' : candidate.track === 'INHOUSE' ? 'Inhouse' : 'Belum ditentukan'} />
          <Field
            label='Tanggal Melamar'
            value={new Date(candidate.applied_at).toLocaleDateString('id-ID', {
              day: 'numeric',
              month: 'long',
              year: 'numeric'
            })}
          />
          <Field label='Sumber' value={sourceLabel(candidate.source)} />
          <Field label='ID Kandidat' value={candidate.profile_code} />
        </CardContent>
      </Card>

      {/* CV */}
      <Card>
        <CardHeader>
          <CardTitle>Curriculum Vitae</CardTitle>
        </CardHeader>
        <CardContent>
          {candidate.cv_url ? (
            <a
              href={candidateCvFileUrl(candidate) ?? undefined}
              target='_blank'
              rel='noreferrer'
              title={candidate.cv_name || 'CV'}
              className='text-primary inline-flex items-center gap-1 text-xs font-medium hover:underline'
            >
              <Icons.paperclip className='size-3.5' />
              Lampiran
            </a>
          ) : (
            <p className='text-muted-foreground text-sm'>Kandidat belum mengunggah CV.</p>
          )}
        </CardContent>
      </Card>

      {/* Status History */}
      <Card>
        <CardHeader>
          <CardTitle>Riwayat Status</CardTitle>
        </CardHeader>
        <CardContent>
          {candidate.status_history.length === 0 ? (
            <p className='text-muted-foreground text-sm'>Belum ada perubahan status.</p>
          ) : (
            <div className='space-y-2'>
              {candidate.status_history.map((h) => (
                <div key={h.id} className='flex items-start gap-3 rounded-lg border p-3 text-sm'>
                  <div className='flex-1'>
                    <p>
                      <span className='font-medium'>{statusLabel(h.from_status)}</span>
                      <span className='text-muted-foreground mx-1.5'>&rarr;</span>
                      <span className='font-medium'>{statusLabel(h.to_status)}</span>
                    </p>
                    {h.note && <p className='text-muted-foreground mt-0.5 text-xs'>{h.note}</p>}
                  </div>
                  <div className='text-muted-foreground shrink-0 text-right text-xs'>
                    <p>{new Date(h.changed_at).toLocaleDateString('id-ID')}</p>
                    {h.changed_by_name && <p>{h.changed_by_name}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
