'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Icons } from '@/components/icons';
import { getManagementDashboard, type ManagementDashboard } from '@/lib/management';

function StatCard({ label, value, icon }: { label: string; value: number; icon: keyof typeof Icons }) {
  const Icon = Icons[icon];
  return (
    <Card>
      <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
        <CardTitle className='text-sm font-medium text-muted-foreground'>{label}</CardTitle>
        <Icon className='text-muted-foreground size-4' />
      </CardHeader>
      <CardContent>
        <p className='text-3xl font-semibold tabular-nums'>{value}</p>
      </CardContent>
    </Card>
  );
}

export function ManagementOverview() {
  const [data, setData] = useState<ManagementDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await getManagementDashboard());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className='space-y-2 p-4 md:p-6'>
        <Skeleton className='h-8 w-64' />
        <Skeleton className='h-40 w-full' />
      </div>
    );
  }

  if (error) {
    return (
      <div className='p-4 md:p-6'>
        <p className='text-destructive'>{error}</p>
      </div>
    );
  }

  const { team, leave } = data!;

  return (
    <div className='flex flex-1 flex-col gap-4 p-4 md:p-6'>
      <div>
        <h2 className='text-2xl font-bold tracking-tight'>Management Overview</h2>
        <p className='text-muted-foreground text-sm'>Ringkasan tim dan persetujuan izin &amp; cuti.</p>
      </div>

      <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4'>
        <StatCard label='Total Tim' value={team.total} icon='teams' />
        <StatCard label='Aktif' value={team.active} icon='user' />
        <StatCard label='Nonaktif' value={team.inactive} icon='user2' />
        <StatCard label='Pengajuan Pending' value={leave.pending} icon='leave' />
      </div>

      <div className='grid grid-cols-1 gap-4 lg:grid-cols-2'>
        <Card>
          <CardHeader>
            <CardTitle className='text-sm'>Distribusi Tim per Departemen</CardTitle>
          </CardHeader>
          <CardContent>
            {team.by_department.length === 0 ? (
              <p className='text-muted-foreground text-sm'>Belum ada anggota tim.</p>
            ) : (
              <ul className='divide-y'>
                {team.by_department.map((d) => (
                  <li key={d.department ?? 'none'} className='flex items-center justify-between py-2 text-sm'>
                    <span>{d.department_name}</span>
                    <span className='font-medium tabular-nums'>{d.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className='text-sm'>Ringkasan Izin &amp; Cuti</CardTitle>
          </CardHeader>
          <CardContent className='space-y-2'>
            <div className='flex items-center justify-between text-sm'>
              <span className='text-muted-foreground'>Pending</span>
              <span className='font-medium tabular-nums'>{leave.pending}</span>
            </div>
            <div className='flex items-center justify-between text-sm'>
              <span className='text-muted-foreground'>Disetujui</span>
              <span className='font-medium tabular-nums'>{leave.approved}</span>
            </div>
            <div className='flex items-center justify-between text-sm'>
              <span className='text-muted-foreground'>Ditolak</span>
              <span className='font-medium tabular-nums'>{leave.rejected}</span>
            </div>
            <div className='flex items-center justify-between text-sm'>
              <span className='text-muted-foreground'>Dibatalkan</span>
              <span className='font-medium tabular-nums'>{leave.cancelled}</span>
            </div>
            <div className='flex items-center justify-between border-t pt-2 text-sm font-semibold'>
              <span>Total</span>
              <span className='tabular-nums'>{leave.total}</span>
            </div>
            <Link
              href='/dashboard/management/leave'
              className='text-primary mt-2 inline-flex items-center gap-1 text-sm font-medium hover:underline'
            >
              <Icons.arrowRight className='size-4' />
              Ke Persetujuan
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
