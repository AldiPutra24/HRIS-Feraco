'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';
import { getMyEmployee } from '@/lib/employee-self';
import { formatDays, getMyBalances, listLeaveRequests, type LeaveRequest, type MyBalance } from '@/lib/leaves';

type MyLeave = { quota: MyBalance | null; requests: LeaveRequest[] };

/** The manager's own annual-leave quota and request counters (not the team's). */
export function MyLeaveCard({ reloadKey = 0 }: { reloadKey?: number }) {
  const [data, setData] = useState<MyLeave | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [me, balances] = await Promise.all([
        getMyEmployee().catch(() => null),
        getMyBalances().catch(() => [] as MyBalance[])
      ]);
      // Managers also see their team's requests server-side; keep only their own.
      const requests = me
        ? (await listLeaveRequests({ employee: String(me.id) }).catch(() => [] as LeaveRequest[])).filter(
            (r) => r.employee === me.id
          )
        : [];
      if (cancelled) return;
      setData({
        quota: balances.find((b) => b.leave_type_code === 'ANNUAL') ?? balances[0] ?? null,
        requests
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const year = new Date().getFullYear();
  const pending = data?.requests.filter((r) => r.status === 'PENDING').length ?? 0;
  const approved =
    data?.requests.filter((r) => r.status === 'APPROVED' && new Date(r.start_date).getFullYear() === year).length ?? 0;
  const quota = data?.quota ?? null;

  return (
    <Card className='gap-4 px-5 py-5'>
      <div className='flex items-start justify-between gap-2'>
        <div>
          <h3 className='text-base font-semibold'>
            Sisa {quota ? quota.leave_type_name.toLowerCase() : 'cuti tahunan'} Anda
          </h3>
          <p className='text-muted-foreground mt-0.5 text-sm'>
            Kuota pribadi
            {quota &&
              `, per ${new Date(quota.as_of).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}`}
          </p>
        </div>
        <span className='bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-xl'>
          <Icons.calendar className='size-5' />
        </span>
      </div>

      {data === null ? (
        <Skeleton className='h-20 w-full' />
      ) : (
        <>
          <p className='flex items-baseline gap-2'>
            <span className='text-4xl font-semibold tabular-nums'>{quota ? formatDays(quota.remaining_days) : '–'}</span>
            <span>{quota ? 'hari' : 'Kuota belum tersedia'}</span>
          </p>
          <div className='flex flex-wrap gap-2 text-xs'>
            <span className='bg-muted text-muted-foreground rounded-md px-2 py-1'>{pending} pengajuan pending</span>
            <span className='bg-muted text-muted-foreground rounded-md px-2 py-1'>{approved} disetujui</span>
          </div>
        </>
      )}

      <div className='flex gap-2'>
        <Link href='/dashboard/management/leave/new' className={cn(buttonVariants(), 'h-10 flex-1')}>
          <Icons.plus className='size-4' />
          Ajukan cuti
        </Link>
        <Link href='/dashboard/management/leave/my' className={cn(buttonVariants({ variant: 'outline' }), 'h-10 px-4')}>
          Riwayat
        </Link>
      </div>
    </Card>
  );
}
