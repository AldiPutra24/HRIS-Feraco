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

export function EmployeeOverview() {
  const { employee, contracts, loading: profileLoading } = useMyEmployee();
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

  if (profileLoading || loading || !employee) {
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
  const current = contracts.find((c) => c.is_current) ?? null;
  const recent = requests.slice(0, 5);

  return (
    <div className='flex flex-1 flex-col gap-4 p-4 md:p-6'>
      <div>
        <h2 className='text-2xl font-bold tracking-tight'>Halo, {employee.full_name}</h2>
        <p className='text-muted-foreground text-sm'>
          {employee.position_name} · {employee.department_name}
        </p>
      </div>

      <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4'>
        <Card>
          <CardHeader>
            <CardTitle className='text-sm'>Sisa Kuota</CardTitle>
          </CardHeader>
          <CardContent>
            <p className='text-3xl font-semibold'>{totalRemaining}</p>
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
        <Card>
          <CardHeader>
            <CardTitle className='text-sm'>Kontrak</CardTitle>
          </CardHeader>
          <CardContent>
            <p className='text-3xl font-semibold'>{current?.contract_type ?? '-'}</p>
            {current?.end_date && (
              <p className='text-muted-foreground text-xs'>sampai {current.end_date}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pengajuan Terbaru</CardTitle>
        </CardHeader>
        <CardContent className='p-0'>
          {recent.length === 0 ? (
            <p className='text-muted-foreground p-6 text-center'>Belum ada pengajuan.</p>
          ) : (
            <div className='divide-y'>
              {recent.map((r) => (
                <div key={r.id} className='flex items-center justify-between px-4 py-3'>
                  <div>
                    <p className='text-sm font-medium'>{r.leave_type_name}</p>
                    <p className='text-muted-foreground text-xs'>
                      {r.start_date} — {r.end_date}
                    </p>
                  </div>
                  <Badge variant={STATUS_VARIANT[r.status] ?? 'secondary'}>{r.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
