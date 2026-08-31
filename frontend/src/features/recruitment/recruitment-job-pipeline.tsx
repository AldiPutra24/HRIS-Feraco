'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'react-toastify';
import { Skeleton } from '@/components/ui/skeleton';
import { listCandidates, type Candidate } from '@/lib/recruitment';
import { ALL_STATUSES, statusLabel } from '@/features/recruitment/candidate-pipeline';

export function RecruitmentJobPipeline({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [groups, setGroups] = useState<Record<string, Candidate[]>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const items = await listCandidates({ job: jobId });
      const next: Record<string, Candidate[]> = {};
      for (const s of ALL_STATUSES) next[s] = [];
      for (const c of items) (next[c.status] ??= []).push(c);
      setGroups(next);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal memuat pipeline.');
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className='space-y-2'>
        <Skeleton className='h-40 w-full' />
      </div>
    );
  }

  const statuses = ALL_STATUSES.filter((s) => (groups[s]?.length ?? 0) > 0);

  return (
    <div className='overflow-x-auto'>
      <div className='flex min-w-max gap-3'>
        {statuses.map((s) => (
          <div key={s} className='w-56 shrink-0 rounded-lg border bg-muted/30 p-2'>
            <p className='mb-2 px-1 text-xs font-medium text-muted-foreground'>
              {statusLabel(s)} <span className='ml-1 text-muted-foreground/70'>({(groups[s] ?? []).length})</span>
            </p>
            <div className='space-y-2'>
              {(groups[s] ?? []).map((c) => (
                <button
                  key={c.id}
                  className='w-full rounded-md border bg-background p-2 text-left text-sm shadow-sm transition-colors hover:bg-muted'
                  onClick={() => router.push(`/dashboard/recruitment/candidates/${c.id}`)}
                >
                  <p className='font-medium'>{c.full_name}</p>
                  <p className='text-muted-foreground truncate text-xs'>{c.email}</p>
                </button>
              ))}
            </div>
          </div>
        ))}
        {statuses.length === 0 && (
          <p className='text-muted-foreground p-4 text-sm'>Belum ada lamaran untuk job ini.</p>
        )}
      </div>
    </div>
  );
}
