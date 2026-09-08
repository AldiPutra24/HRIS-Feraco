'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Icons } from '@/components/icons';
import { listAnnouncements, type Announcement } from '@/lib/announcements';
import { listBalances, listLeaveRequests, type LeaveBalance, type LeaveRequest } from '@/lib/leaves';
import { useMyEmployee } from './use-my-employee';

function fmtDate(iso: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  PENDING: 'secondary',
  APPROVED: 'default',
  REJECTED: 'destructive',
  CANCELLED: 'outline',
  DRAFT: 'outline'
};

function greeting(): string {
  const h = new Date().getHours();
  if (h < 11) return 'Selamat pagi';
  if (h < 15) return 'Selamat siang';
  if (h < 19) return 'Selamat sore';
  return 'Selamat malam';
}

export function EmployeeOverview() {
  const { employee, contracts, loading: profileLoading } = useMyEmployee();
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<Announcement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [b, r, a] = await Promise.all([listBalances(), listLeaveRequests(), listAnnouncements()]);
    setBalances(b);
    setRequests(r);
    setAnnouncements(a.slice(0, 3));
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
  const accumulation = employee.contract_accumulation;
  const recent = requests.slice(0, 5);

  return (
    <div className='flex flex-1 flex-col gap-4 p-4 md:p-6'>
      <div className='flex items-center gap-4'>
        {employee.photo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={employee.photo_url}
            alt={employee.full_name}
            className='size-14 rounded-full border object-cover'
          />
        ) : (
          <div className='bg-muted text-muted-foreground flex size-14 items-center justify-center rounded-full border text-lg font-semibold'>
            {employee.full_name.charAt(0).toUpperCase()}
          </div>
        )}
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>{greeting()}, {employee.full_name}</h2>
          <p className='text-muted-foreground text-sm'>
            {employee.position_name} · {employee.department_name}
          </p>
        </div>
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
            {current?.duration_display && (
              <p className='text-muted-foreground text-xs'>durasi {current.duration_display}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Akumulasi Kontrak</CardTitle>
          </CardHeader>
          <CardContent>
            <p className='text-3xl font-semibold'>{accumulation?.display ?? '-'}</p>
            {accumulation && (
              <p className='text-muted-foreground text-xs'>{accumulation.contracts.length} kontrak</p>
            )}
          </CardContent>
        </Card>
      </div>

      {announcements.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className='flex items-center gap-2'>
              <Icons.notification className='size-4' />
              Pengumuman
            </CardTitle>
          </CardHeader>
          <CardContent className='space-y-3'>
            {announcements.map((a) => (
              <button
                key={a.id}
                type='button'
                onClick={() => setDetail(a)}
                className='hover:bg-muted block w-full border-b pb-3 text-left last:border-0 last:pb-0'
              >
                <p className='text-sm font-medium'>{a.title}</p>
                <p className='text-muted-foreground text-xs'>{fmtDate(a.created_at)}</p>
                <p className='text-muted-foreground line-clamp-2 text-sm'>{a.body}</p>
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      <Sheet open={detail !== null} onOpenChange={(o) => !o && setDetail(null)}>
        <SheetContent side='right' className='w-full sm:max-w-md'>
          <SheetHeader>
            <SheetTitle>{detail?.title}</SheetTitle>
            <SheetDescription>
              Dipublikasikan {detail ? fmtDate(detail.created_at) : ''}
              {detail?.created_by_name ? ` · ${detail.created_by_name}` : ''}
            </SheetDescription>
          </SheetHeader>
          <div className='whitespace-pre-wrap px-4 py-4 text-sm'>{detail?.body}</div>
        </SheetContent>
      </Sheet>

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
