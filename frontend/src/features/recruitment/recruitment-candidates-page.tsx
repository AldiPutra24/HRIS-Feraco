'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'react-toastify';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { listCandidates, listJobs, type Candidate, type Job } from '@/lib/recruitment';
import { ALL_STATUSES, statusLabel } from '@/features/recruitment/candidate-pipeline';

const STATUS_OPTIONS = [...ALL_STATUSES];

function statusVariant(status: string): 'default' | 'secondary' | 'outline' {
  if (status === 'REJECTED') return 'outline';
  if (status === 'WITHDRAWN') return 'secondary';
  return 'default';
}

export function RecruitmentCandidatesPage({ fixedJobId }: { fixedJobId?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fJob = fixedJobId ?? (searchParams.get('job') ?? '');
  const fStatus = searchParams.get('status') ?? '';

  function setFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams);
    if (value) params.set(key, value);
    else params.delete(key);
    router.replace(`/dashboard/recruitment/candidates${params.size ? `?${params}` : ''}`);
  }

  const [items, setItems] = useState<Candidate[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (fJob) params.job = fJob;
    if (fStatus) params.status = fStatus;
    try {
      const candidates = await listCandidates(params);
      setItems(candidates);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal memuat data.');
    } finally {
      setLoading(false);
    }
  }, [fJob, fStatus]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    listJobs().then(setJobs).catch(() => {});
  }, []);

  if (loading && items.length === 0) {
    return (
      <div className='space-y-2 p-4 md:p-6'>
        <Skeleton className='h-8 w-64' />
        <Skeleton className='h-40 w-full' />
      </div>
    );
  }

  return (
    <div className='flex flex-1 flex-col gap-4 p-4 md:p-6'>
      <div>
        <h2 className='text-2xl font-bold tracking-tight'>Candidate Inbox</h2>
        <p className='text-muted-foreground text-sm'>Kelola lamaran masuk dari portal publik.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filter</CardTitle>
        </CardHeader>
        <CardContent>
          <div className='grid grid-cols-1 gap-3 md:grid-cols-3'>
            {!fixedJobId && (
              <div>
                <Label className='text-xs'>Job</Label>
                <select
                  className='border-input h-9 w-full rounded-lg border bg-transparent px-2.5 text-sm'
                  value={fJob}
                  onChange={(e) => setFilter('job', e.target.value)}
                >
                  <option value=''>Semua job</option>
                  {jobs.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.title}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {fixedJobId && (
              <div>
                <Label className='text-xs'>Job</Label>
                <p className='text-muted-foreground text-sm'>{jobs.find((j) => String(j.id) === fixedJobId)?.title ?? '-'}</p>
              </div>
            )}
            <div>
              <Label className='text-xs'>Status</Label>
              <select
                className='border-input h-9 w-full rounded-lg border bg-transparent px-2.5 text-sm'
                value={fStatus}
                onChange={(e) => setFilter('status', e.target.value)}
              >
                <option value=''>Semua status</option>
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {statusLabel(s)}
                  </option>
                ))}
              </select>
            </div>
            <div className='flex items-end'>
              <Button variant='ghost' onClick={() => router.replace('/dashboard/recruitment/candidates')}>
                Reset
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Daftar Kandidat</CardTitle>
        </CardHeader>
        <CardContent className='p-0'>
          {items.length === 0 ? (
            <p className='text-muted-foreground p-6 text-center'>Belum ada lamaran.</p>
          ) : (
            <div className='overflow-x-auto'>
              <table className='w-full text-sm'>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Job</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Applied Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>CV</TableHead>
                    <TableHead className='text-right'>Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className='font-medium'>{c.full_name}</TableCell>
                      <TableCell>{c.job_title}</TableCell>
                      <TableCell>{c.email}</TableCell>
                      <TableCell>{c.phone || '-'}</TableCell>
                      <TableCell>{new Date(c.applied_at).toLocaleDateString('id-ID')}</TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(c.status)}>{statusLabel(c.status)}</Badge>
                      </TableCell>
                      <TableCell>
                        {c.cv_url ? (
                          <a
                            href={`/dashboard/recruitment/candidates/${c.id}`}
                            className='text-primary text-sm font-medium hover:underline'
                          >
                            {c.cv_name || 'CV'}
                          </a>
                        ) : (
                          '-'
                        )}
                      </TableCell>
                      <TableCell className='text-right'>
                        <Button
                          size='sm'
                          variant='ghost'
                          onClick={() => router.push(`/dashboard/recruitment/candidates/${c.id}`)}
                        >
                          Detail
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
