'use client';

import { useEffect, useState } from 'react';
import { notFound, useRouter } from 'next/navigation';
import { toast } from 'react-toastify';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { getCandidate, getCandidateCv, type Candidate } from '@/lib/recruitment';

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

export function RecruitmentCandidateDetailPage({ id }: { id: string }) {
  const router = useRouter();
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [notFoundState, setNotFoundState] = useState(false);
  const [loading, setLoading] = useState(true);
  const [cvLoading, setCvLoading] = useState(false);

  useEffect(() => {
    getCandidate(Number(id))
      .then(setCandidate)
      .catch(() => setNotFoundState(true))
      .finally(() => setLoading(false));
  }, [id]);

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

  if (loading) {
    return (
      <div className='space-y-2 p-4 md:p-6'>
        <Skeleton className='h-8 w-64' />
        <Skeleton className='h-40 w-full' />
      </div>
    );
  }

  if (!candidate) return null;

  return (
    <div className='flex flex-1 flex-col gap-4 p-4 md:p-6'>
      <div className='flex items-center justify-between'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>{candidate.full_name}</h2>
          <p className='text-muted-foreground text-sm'>Detail lamaran kandidat.</p>
        </div>
        <Button variant='ghost' onClick={() => router.back()}>
          Kembali
        </Button>
      </div>

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
          <Field
            label='Sumber'
            value={sourceLabel(candidate.source)}
          />
          <Field
            label='Status'
            value={<Badge variant={candidate.status === 'APPLIED' ? 'default' : 'secondary'}>{candidate.status}</Badge>}
          />
        </CardContent>
      </Card>

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
    </div>
  );
}
