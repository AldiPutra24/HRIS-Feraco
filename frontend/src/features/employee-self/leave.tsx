'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { listBalances, listLeaveRequests, type LeaveBalance, type LeaveRequest } from '@/lib/leaves';
import { useMyEmployee } from './use-my-employee';

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  PENDING: 'secondary',
  APPROVED: 'default',
  REJECTED: 'destructive',
  CANCELLED: 'outline',
  DRAFT: 'outline'
};

function StatusBadge({ status }: { status: string }) {
  return <Badge variant={STATUS_VARIANT[status] ?? 'secondary'}>{status}</Badge>;
}

export function EmployeeLeave() {
  const { loading: profileLoading, error: profileError } = useMyEmployee();
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [b, r] = await Promise.all([listBalances(), listLeaveRequests()]);
    setBalances(b);
    setRequests(r);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (profileError) {
    return (
      <div className='p-4 md:p-6'>
        <p className='text-destructive'>{profileError}</p>
      </div>
    );
  }

  if (profileLoading || loading) {
    return (
      <div className='space-y-2 p-4 md:p-6'>
        <Skeleton className='h-8 w-64' />
        <Skeleton className='h-40 w-full' />
      </div>
    );
  }

  const pending = requests.filter((r) => r.status === 'PENDING').length;
  const approved = requests.filter((r) => r.status === 'APPROVED').length;
  const totalRemaining = balances.reduce((sum, b) => sum + b.remaining_days, 0);

  return (
    <div className='flex flex-1 flex-col gap-4 p-4 md:p-6'>
      <div>
        <h2 className='text-2xl font-bold tracking-tight'>Pengajuan Saya</h2>
        <p className='text-muted-foreground text-sm'>Riwayat pengajuan izin dan cuti Anda.</p>
      </div>

      <div className='grid grid-cols-1 gap-4 sm:grid-cols-3'>
        <Card>
          <CardHeader>
            <CardTitle className='text-sm'>Sisa Kuota</CardTitle>
          </CardHeader>
          <CardContent>
            <p className='text-3xl font-semibold'>{totalRemaining}</p>
            <p className='text-muted-foreground text-xs'>hari tersisa</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className='text-sm'>Pending</CardTitle>
          </CardHeader>
          <CardContent>
            <p className='text-3xl font-semibold'>{pending}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className='text-sm'>Disetujui</CardTitle>
          </CardHeader>
          <CardContent>
            <p className='text-3xl font-semibold'>{approved}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Riwayat Pengajuan</CardTitle>
        </CardHeader>
        <CardContent className='p-0'>
          {requests.length === 0 ? (
            <p className='text-muted-foreground p-6 text-center'>Belum ada pengajuan.</p>
          ) : (
            <div className='overflow-x-auto'>
              <table className='w-full text-sm'>
                <thead>
                  <tr className='border-b text-left text-xs text-muted-foreground'>
                    <th className='px-4 py-2'>Jenis</th>
                    <th className='px-4 py-2'>Periode</th>
                    <th className='px-4 py-2'>Hari</th>
                    <th className='px-4 py-2'>Status</th>
                    <th className='px-4 py-2'>Alasan</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((r) => (
                    <tr key={r.id} className='border-b'>
                      <td className='px-4 py-2'>
                        {r.leave_type_name}
                        {r.leave_type_kind === 'PERMISSION' && (
                          <span className='text-muted-foreground ml-1 text-xs'>(Izin)</span>
                        )}
                      </td>
                      <td className='px-4 py-2'>
                        {r.start_date} — {r.end_date}
                      </td>
                      <td className='px-4 py-2'>{r.total_days}</td>
                      <td className='px-4 py-2'>
                        <StatusBadge status={r.status} />
                      </td>
                      <td className='max-w-48 whitespace-normal break-words px-4 py-2'>{r.reason || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
