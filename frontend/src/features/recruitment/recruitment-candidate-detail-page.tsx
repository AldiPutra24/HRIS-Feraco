'use client';

import { useEffect, useState } from 'react';
import { notFound, useRouter } from 'next/navigation';
import { toast } from 'react-toastify';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { getCandidate, getCandidateCv, transitionCandidate, hardDeleteCandidate, type Candidate } from '@/lib/recruitment';
import { PIPELINE, statusLabel } from '@/features/recruitment/candidate-pipeline';
import { useAuth } from '@/lib/auth/auth-provider';

function sourceLabel(v: string): string {
  return v.replace('_', ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
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
  const idx = PIPELINE.indexOf(current as typeof PIPELINE[number]);
  return (
    <div className='flex items-center gap-0 overflow-x-auto'>
      {PIPELINE.map((s, i) => {
        const done = idx >= i;
        const active = idx === i;
        return (
          <div key={s} className='flex items-center min-w-0'>
            <div
              className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap ${
                active
                  ? 'bg-primary text-primary-foreground ring-2 ring-primary/30'
                  : done
                    ? 'bg-primary/10 text-primary'
                    : 'bg-muted text-muted-foreground'
              }`}
            >
              <span className='hidden sm:inline'>{statusLabel(s)}</span>
              <span className='sm:hidden'>{s === 'INTERVIEW_HR' ? 'HR' : s === 'INTERVIEW_USER' ? 'User' : s === 'INTERVIEW_GM' ? 'GM' : statusLabel(s).slice(0, 3)}</span>
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

export function RecruitmentCandidateDetailPage({ id }: { id: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [notFoundState, setNotFoundState] = useState(false);
  const [loading, setLoading] = useState(true);
  const [cvLoading, setCvLoading] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [note, setNote] = useState('');

  function load() {
    setLoading(true);
    setNote('');
    getCandidate(Number(id))
      .then(setCandidate)
      .catch(() => setNotFoundState(true))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (notFoundState) notFound();

  async function downloadCv() {
    if (!candidate) return;
    setCvLoading(true);
    try {
      const { url } = await getCandidateCv(candidate.id);
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal memuat CV.');
    } finally {
      setCvLoading(false);
    }
  }

  async function handleTransition(toStatus: string) {
    if (!candidate) return;
    setTransitioning(true);
    try {
      await transitionCandidate(candidate.id, toStatus, note);
      toast.success(`Status diubah ke ${statusLabel(toStatus)}`);
      setNote('');
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal mengubah status.');
    } finally {
      setTransitioning(false);
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

  if (loading) {
    return (
      <div className='space-y-2 p-4 md:p-6'>
        <Skeleton className='h-8 w-64' />
        <Skeleton className='h-40 w-full' />
      </div>
    );
  }

  if (!candidate) return null;

  const isTerminal = candidate.status === 'REJECTED' || candidate.status === 'WITHDRAWN';
  const nextStatuses: string[] = candidate.next_statuses ?? [];
  const normalNext = nextStatuses.filter((s) => s !== 'REJECTED' && s !== 'WITHDRAWN');
  const terminalNext = nextStatuses.filter((s) => s === 'REJECTED' || s === 'WITHDRAWN');

  return (
    <div className='flex flex-1 flex-col gap-4 p-4 md:p-6'>
      <div className='flex items-center justify-between'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>{candidate.full_name}</h2>
          <p className='text-muted-foreground text-sm'>Detail lamaran kandidat.</p>
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

      {/* Pipeline */}
      <Card>
        <CardHeader>
          <CardTitle>Pipeline</CardTitle>
          <CardDescription>
            Status saat ini: <Badge variant={candidate.status === 'APPLIED' ? 'default' : 'secondary'}>{statusLabel(candidate.status)}</Badge>
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <PipelineSteps current={candidate.status} />

          {!isTerminal && nextStatuses.length > 0 && (
            <div className='space-y-3 rounded-lg border p-3'>
              <p className='text-xs font-medium text-muted-foreground'>Ubah Status</p>
              {normalNext.length > 0 && (
                <div className='flex flex-wrap gap-2'>
                  {normalNext.map((s) => (
                    <Button
                      key={s}
                      size='sm'
                      variant='default'
                      disabled={transitioning}
                      onClick={() => handleTransition(s)}
                    >
                      {statusLabel(s)}
                    </Button>
                  ))}
                </div>
              )}
              {terminalNext.length > 0 && (
                <div className='flex flex-wrap gap-2'>
                  {terminalNext.map((s) => (
                    <Button
                      key={s}
                      size='sm'
                      variant={s === 'REJECTED' ? 'destructive' : 'outline'}
                      disabled={transitioning}
                      onClick={() => handleTransition(s)}
                    >
                      {statusLabel(s)}
                    </Button>
                  ))}
                </div>
              )}
              <div>
                <p className='mb-1 text-xs text-muted-foreground'>Catatan (opsional)</p>
                <input
                  className='border-input h-9 w-full max-w-md rounded-lg border bg-transparent px-2.5 text-sm'
                  placeholder='Alasan perubahan status...'
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
            </div>
          )}

          {isTerminal && (
            <p className='text-sm text-muted-foreground'>
              Kandidat telah {statusLabel(candidate.status).toLowerCase()}. Tidak ada transisi lebih lanjut.
            </p>
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
          <Field
            label='Tanggal Melamar'
            value={new Date(candidate.applied_at).toLocaleDateString('id-ID', {
              day: 'numeric',
              month: 'long',
              year: 'numeric'
            })}
          />
          <Field label='Sumber' value={sourceLabel(candidate.source)} />
        </CardContent>
      </Card>

      {/* CV */}
      <Card>
        <CardHeader>
          <CardTitle>Curriculum Vitae</CardTitle>
        </CardHeader>
        <CardContent>
          {candidate.cv_url ? (
            <Button onClick={downloadCv} disabled={cvLoading}>
              {cvLoading ? 'Memuat...' : 'Unduh CV'}
            </Button>
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
                      <span className='mx-1.5 text-muted-foreground'>&rarr;</span>
                      <span className='font-medium'>{statusLabel(h.to_status)}</span>
                    </p>
                    {h.note && <p className='text-muted-foreground mt-0.5 text-xs'>{h.note}</p>}
                  </div>
                  <div className='shrink-0 text-right text-xs text-muted-foreground'>
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
