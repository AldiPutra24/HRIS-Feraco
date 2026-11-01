'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';
import { formatDays, getMyBalances, listLeaveRequests, type LeaveRequest, type MyBalance } from '@/lib/leaves';
import { useMyEmployee } from './use-my-employee';

type Filter = 'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'ALL', label: 'Semua' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Disetujui' },
  { value: 'REJECTED', label: 'Ditolak' }
];

const STATUS: Record<string, { label: string; className: string }> = {
  PENDING: { label: 'Menunggu', className: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300' },
  APPROVED: { label: 'Disetujui', className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300' },
  REJECTED: { label: 'Ditolak', className: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300' },
  CANCELLED: { label: 'Dibatalkan', className: 'bg-muted text-muted-foreground' },
  DRAFT: { label: 'Draft', className: 'bg-muted text-muted-foreground' }
};

const STEPS = [
  { title: 'Pilih jenis & tanggal', text: 'Tanggal boleh tidak berurutan. Total hari dihitung otomatis.' },
  { title: 'Lampirkan dokumen', text: 'Surat dokter untuk sakit lebih dari 1 hari, atau bukti persetujuan atasan untuk izin.' },
  { title: 'Tunggu persetujuan', text: 'Atasan Anda menerima notifikasi dan memproses pengajuan.' }
];

function fmtDate(v: string, withYear = true): string {
  return new Date(v).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) });
}

function StatCard({ title, icon, value, unit, hint }: { title: string; icon: keyof typeof Icons; value: string; unit?: string; hint: string }) {
  const Icon = Icons[icon];
  return (
    <Card className='gap-3 px-6 py-6'>
      <div className='text-muted-foreground flex items-center justify-between text-sm'>
        <span>{title}</span>
        <Icon className='size-5' />
      </div>
      <p className='flex items-baseline gap-2'>
        <span className='text-4xl font-semibold tabular-nums'>{value}</span>
        {unit && <span className='text-base'>{unit}</span>}
      </p>
      <p className='text-muted-foreground text-sm'>{hint}</p>
    </Card>
  );
}

/** "Izin & Cuti": own quota, request counters and history. */
export function EmployeeLeave({ newHref = '/dashboard/employee/leave/new' }: { newHref?: string }) {
  const { employee, loading: profileLoading, error: profileError } = useMyEmployee();
  const [balances, setBalances] = useState<MyBalance[]>([]);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('ALL');

  const load = useCallback(async () => {
    setLoading(true);
    // HR/Management also see others' requests server-side (paginated), so ask
    // the API for the caller's own employee only — own rows are never cut off.
    const myId = employee?.id ?? null;
    const [b, r] = await Promise.all([
      getMyBalances().catch(() => [] as MyBalance[]),
      listLeaveRequests(myId ? { employee: String(myId) } : undefined)
    ]);
    setBalances(b);
    setRequests(myId ? r.filter((x) => x.employee === myId) : r);
    setLoading(false);
  }, [employee?.id]);

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

  const year = new Date().getFullYear();
  const pending = requests.filter((r) => r.status === 'PENDING');
  const pendingDays = pending.reduce((sum, r) => sum + r.total_days, 0);
  const approvedThisYear = requests.filter((r) => r.status === 'APPROVED' && new Date(r.start_date).getFullYear() === year);
  const approvedDays = approvedThisYear.reduce((sum, r) => sum + r.total_days, 0);
  // Sisa kuota "per hari ini" from the quota engine (Cuti Tahunan first).
  const mainQuota = balances.find((b) => b.leave_type_code === 'ANNUAL') ?? balances[0] ?? null;
  const visible = requests.filter((r) => filter === 'ALL' || r.status === filter);

  return (
    <div className='flex flex-1 flex-col gap-6 p-4 md:p-8'>
      <div className='flex flex-wrap items-start justify-between gap-4'>
        <div>
          <h2 className='text-3xl font-bold tracking-tight'>Izin &amp; Cuti</h2>
          <p className='text-muted-foreground mt-1'>Pantau sisa kuota dan status semua pengajuan izin dan cuti Anda.</p>
        </div>
        <Button size='lg' render={<Link href={newHref} />}>
          <Icons.plus className='size-4' />
          Ajukan Izin / Cuti
        </Button>
      </div>

      <div className='grid gap-4 md:grid-cols-3'>
        <StatCard
          title={mainQuota ? `Sisa ${mainQuota.leave_type_name}` : 'Sisa Cuti Tahunan'}
          icon='calendar'
          value={mainQuota ? formatDays(mainQuota.remaining_days) : '–'}
          unit='hari'
          hint={mainQuota ? `Per ${fmtDate(mainQuota.as_of)}` : 'Kuota belum tersedia'}
        />
        <StatCard
          title='Menunggu Persetujuan'
          icon='clock'
          value={String(pending.length)}
          hint={pending.length ? `${formatDays(pendingDays)} hari diajukan` : 'Tidak ada yang tertunda'}
        />
        <StatCard
          title='Disetujui Tahun Ini'
          icon='check'
          value={String(approvedThisYear.length)}
          hint={`${formatDays(approvedDays)} hari terpakai`}
        />
      </div>

      <Card className='gap-0 py-0'>
        <div className='flex flex-wrap items-center justify-between gap-3 px-6 py-5'>
          <h3 className='text-lg font-semibold'>Riwayat Pengajuan</h3>
          <div className='flex flex-wrap gap-2'>
            {FILTERS.map((f) => (
              <button
                key={f.value}
                type='button'
                onClick={() => setFilter(f.value)}
                className={cn(
                  'rounded-lg border px-3.5 py-1.5 text-sm transition-colors',
                  filter === f.value ? 'bg-foreground text-background border-foreground font-medium' : 'hover:bg-muted'
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <div className='overflow-x-auto border-t'>
          <table className='w-full text-sm'>
            <thead className='bg-muted/40 text-muted-foreground text-left'>
              <tr>
                <th className='px-6 py-3 font-medium'>Jenis &amp; Kategori</th>
                <th className='px-4 py-3 font-medium'>Tanggal</th>
                <th className='px-4 py-3 font-medium'>Durasi</th>
                <th className='px-4 py-3 font-medium'>Diajukan</th>
                <th className='px-6 py-3 text-right font-medium'>Status</th>
              </tr>
            </thead>
            {visible.length > 0 && (
              <tbody className='divide-y'>
                {visible.map((r) => {
                  const st = STATUS[r.status] ?? { label: r.status, className: 'bg-muted' };
                  return (
                    <tr key={r.id}>
                      <td className='px-6 py-3.5'>
                        <p className='font-medium'>{r.leave_type_kind === 'PERMISSION' ? 'Izin' : 'Cuti'}</p>
                        <p className='text-muted-foreground text-xs'>{r.leave_type_name}</p>
                        {r.status === 'REJECTED' && r.rejection_reason && (
                          <p className='text-destructive mt-0.5 max-w-72 text-xs'>Alasan ditolak: {r.rejection_reason}</p>
                        )}
                      </td>
                      <td className='max-w-64 px-4 py-3.5'>{r.leave_dates_display || `${r.start_date} — ${r.end_date}`}</td>
                      <td className='px-4 py-3.5 tabular-nums whitespace-nowrap'>{formatDays(r.total_days)} hari</td>
                      <td className='text-muted-foreground px-4 py-3.5 whitespace-nowrap'>{fmtDate(r.submitted_at || r.created_at)}</td>
                      <td className='px-6 py-3.5 text-right'>
                        <span className={cn('inline-flex rounded-full px-2.5 py-1 text-xs font-medium', st.className)}>{st.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            )}
          </table>
          {visible.length === 0 && (
            <div className='flex flex-col items-center gap-2 px-6 py-14 text-center'>
              <span className='bg-muted mb-2 flex size-14 items-center justify-center rounded-2xl'>
                <Icons.calendar className='text-muted-foreground size-6' />
              </span>
              <p className='font-semibold'>{requests.length === 0 ? 'Belum ada pengajuan' : 'Tidak ada pengajuan di filter ini'}</p>
              <p className='text-muted-foreground max-w-md text-sm'>
                Pengajuan yang Anda kirim akan muncul di sini, lengkap dengan status persetujuan dari atasan.
              </p>
              {requests.length === 0 && (
                <Button variant='outline' className='mt-3' render={<Link href={newHref} />}>
                  <Icons.plus className='size-4' />
                  Buat pengajuan
                </Button>
              )}
            </div>
          )}
        </div>
      </Card>

      <Card className='grid gap-5 px-6 py-6 md:grid-cols-3'>
        {STEPS.map((s, i) => (
          <div key={s.title} className='flex items-start gap-3'>
            <span className='bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg text-sm font-semibold'>
              {i + 1}
            </span>
            <div>
              <p className='font-semibold'>{s.title}</p>
              <p className='text-muted-foreground text-sm'>{s.text}</p>
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}
