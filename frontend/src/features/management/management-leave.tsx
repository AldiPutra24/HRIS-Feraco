'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'react-toastify';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth/auth-provider';
import { getMyEmployee } from '@/lib/employee-self';
import {
  approveLeave,
  formatDays,
  getBalanceSummary,
  listLeaveRequests,
  listLeaveTypes,
  rejectLeave,
  type LeaveRequest,
  type LeaveType,
  type MyBalance
} from '@/lib/leaves';
import { TeamQuotaCard } from './team-quota-card';

type Tab = 'PENDING' | 'HISTORY';

const STATUS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: 'Menunggu', cls: 'bg-orange-500/10 text-orange-700 dark:text-orange-300' },
  APPROVED: { label: 'Disetujui', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' },
  REJECTED: { label: 'Ditolak', cls: 'bg-red-500/10 text-red-700 dark:text-red-300' },
  CANCELLED: { label: 'Dibatalkan', cls: 'bg-muted text-muted-foreground' },
  DRAFT: { label: 'Draft', cls: 'bg-muted text-muted-foreground' }
};

function initials(name: string): string {
  return name
    .replace(/\([^)]*\)/g, '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

function parseDay(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}

function StatusPill({ status }: { status: string }) {
  const st = STATUS[status] ?? { label: status, cls: 'bg-muted text-muted-foreground' };
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap', st.cls)}>
      <span className='size-1.5 rounded-full bg-current' />
      {st.label}
    </span>
  );
}

/** Per-day chips: "SEN 9 · Nov 2026 · Sehari penuh / Setengah hari". */
function DayChips({ r }: { r: LeaveRequest }) {
  const days = r.leave_days?.length ? r.leave_days : r.leave_dates.map((date) => ({ date, portion: 'FULL' as const }));
  return (
    <div className='flex flex-wrap gap-2'>
      {days.map((d) => {
        const dt = parseDay(d.date);
        return (
          <div key={d.date} className='flex items-center gap-3 rounded-xl border px-3.5 py-2'>
            <span className='text-center leading-tight'>
              <span className='text-muted-foreground block text-[11px] font-medium uppercase'>
                {dt.toLocaleDateString('id-ID', { weekday: 'short' })}
              </span>
              <span className='block text-lg font-semibold tabular-nums'>{dt.getDate()}</span>
            </span>
            <span className='leading-tight'>
              <span className='block text-sm'>{dt.toLocaleDateString('id-ID', { month: 'short', year: 'numeric' })}</span>
              <span className={cn('block text-sm', d.portion === 'HALF' ? 'text-orange-700 dark:text-orange-300' : 'text-muted-foreground')}>
                {d.portion === 'HALF' ? 'Setengah hari' : 'Sehari penuh'}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** "Dampak ke kuota": balance of the type this request deducts from. */
function ImpactPanel({
  r,
  balance,
  loading,
  acting,
  onApprove,
  onReject
}: {
  r: LeaveRequest;
  balance: MyBalance | null;
  loading: boolean;
  acting: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const after = balance ? balance.remaining_days - r.total_days : null;
  const total = balance ? Math.max(balance.allocated_days + balance.adjustment_days, balance.used_days + r.total_days, 0) : 0;
  return (
    <div className='bg-muted/30 flex flex-col gap-4 rounded-xl border px-5 py-5'>
      {loading ? (
        <Skeleton className='h-28 w-full' />
      ) : balance ? (
        <>
          <p className='text-sm font-semibold'>Dampak ke kuota {balance.leave_type_name}</p>
          <div className='flex items-end gap-4'>
            <div>
              <p className='text-muted-foreground text-xs'>Sisa sekarang</p>
              <p className='text-3xl font-semibold tabular-nums'>{formatDays(balance.remaining_days)}</p>
            </div>
            <Icons.arrowRight className='text-muted-foreground mb-2 size-4' />
            <div>
              <p className='text-muted-foreground text-xs'>Jika disetujui</p>
              <p
                className={cn(
                  'text-3xl font-semibold tabular-nums',
                  after !== null && after < 0 ? 'text-destructive' : 'text-primary'
                )}
              >
                {formatDays(after)}
              </p>
            </div>
            <span className='text-muted-foreground mb-1.5 text-sm'>hari</span>
          </div>
          {total > 0 && (
            <div className='bg-muted flex h-2.5 overflow-hidden rounded-full'>
              <div className='bg-foreground/70 h-full' style={{ width: `${(balance.used_days / total) * 100}%` }} />
              <div
                className='h-full bg-orange-500 bg-[repeating-linear-gradient(135deg,transparent_0_4px,rgba(255,255,255,0.35)_4px_8px)]'
                style={{ width: `${(Math.min(r.total_days, total) / total) * 100}%` }}
              />
              <div className='bg-primary h-full flex-1' />
            </div>
          )}
          <div className='text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs'>
            <span className='flex items-center gap-1.5'>
              <span className='bg-foreground/70 size-2 rounded-sm' />
              Terpakai {formatDays(balance.used_days)}
            </span>
            <span className='flex items-center gap-1.5'>
              <span className='size-2 rounded-sm bg-orange-500' />
              Pengajuan ini {formatDays(r.total_days)}
            </span>
            <span className='flex items-center gap-1.5'>
              <span className='bg-primary size-2 rounded-sm' />
              Sisa {formatDays(Math.max(after ?? 0, 0))} dari {formatDays(balance.allocated_days + balance.adjustment_days)}
            </span>
          </div>
          {after !== null && after < 0 && (
            <p className='text-destructive text-xs'>Melebihi sisa kuota sebanyak {formatDays(-after)} hari.</p>
          )}
        </>
      ) : (
        <>
          <p className='text-sm font-semibold'>Dampak ke kuota</p>
          <p className='text-muted-foreground text-sm'>Jenis ini tidak memotong kuota cuti.</p>
        </>
      )}
      {r.can_decide ? (
        <div className='flex gap-2'>
          <Button
            variant='outline'
            className='text-destructive border-destructive/30 hover:bg-destructive/5 h-11 flex-1'
            disabled={acting}
            onClick={onReject}
          >
            Tolak
          </Button>
          <Button className='h-11 flex-[2]' disabled={acting} onClick={onApprove}>
            {acting ? <Icons.spinner className='size-4 animate-spin' /> : <Icons.check className='size-4' />}
            Setujui {formatDays(r.total_days)} hari
          </Button>
        </div>
      ) : (
        // Only the direct Reporting To (or HR) decides — a GM sees deeper levels read-only.
        <p className='text-muted-foreground rounded-lg border border-dashed px-3 py-2.5 text-center text-sm'>
          Menunggu keputusan {r.employee_manager_name || 'atasan langsung'}
        </p>
      )}
    </div>
  );
}

export function ManagementLeave() {
  const { user } = useAuth();
  // Backend scopes the quota table: GM = all active employees, Management = direct reports.
  const isGm = user?.role === 'general_manager';
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [myEmployeeId, setMyEmployeeId] = useState<number | null>(null);
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [balances, setBalances] = useState<Record<string, MyBalance[] | null>>({});
  const [tab, setTab] = useState<Tab>('PENDING');
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<Record<number, boolean>>({});
  const [rejecting, setRejecting] = useState<LeaveRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectingSubmit, setRejectingSubmit] = useState(false);
  const [quotaKey, setQuotaKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Backend already scopes MANAGEMENT/GM to their team + own requests.
      const [r, me, t] = await Promise.all([
        listLeaveRequests(),
        getMyEmployee().catch(() => null),
        listLeaveTypes().catch(() => [] as LeaveType[])
      ]);
      setRequests(r);
      setMyEmployeeId(me?.id ?? null);
      setTypes(t);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal memuat pengajuan.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Team requests only: the manager's own requests live in "Izin & Cuti Saya".
  const team = useMemo(() => requests.filter((r) => r.employee !== myEmployeeId), [requests, myEmployeeId]);
  const pending = useMemo(
    () => team.filter((r) => r.status === 'PENDING').sort((a, b) => Number(!!b.can_decide) - Number(!!a.can_decide) || a.start_date.localeCompare(b.start_date)),
    [team]
  );
  const history = useMemo(
    () => team.filter((r) => r.status !== 'PENDING' && r.status !== 'DRAFT').sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    [team]
  );
  const awaitingMe = pending.filter((r) => r.can_decide).length;

  // Balances of each pending requester (per employee + year).
  useEffect(() => {
    for (const r of pending) {
      const key = `${r.employee}-${r.start_date.slice(0, 4)}`;
      if (key in balances) continue;
      setBalances((b) => ({ ...b, [key]: null }));
      getBalanceSummary(r.employee, Number(r.start_date.slice(0, 4)))
        .then((rows) => setBalances((b) => ({ ...b, [key]: rows })))
        .catch(() => setBalances((b) => ({ ...b, [key]: [] })));
    }
  }, [pending, balances]);

  function balanceFor(r: LeaveRequest): { loading: boolean; balance: MyBalance | null } {
    const rows = balances[`${r.employee}-${r.start_date.slice(0, 4)}`];
    if (rows == null) return { loading: true, balance: null };
    // Same rule as the backend deduction: `deducts_from` target, else the type itself.
    const target = types.find((t) => t.id === r.leave_type)?.deducts_from ?? r.leave_type;
    return { loading: false, balance: rows.find((b) => b.leave_type === target) ?? null };
  }

  function overlaps(r: LeaveRequest): string[] {
    const dates = new Set(r.leave_dates);
    return team
      .filter((o) => o.id !== r.id && o.employee !== r.employee && (o.status === 'PENDING' || o.status === 'APPROVED'))
      .filter((o) => o.leave_dates.some((d) => dates.has(d)))
      .map((o) => o.employee_name);
  }

  const applyUpdate = useCallback((updated: LeaveRequest) => {
    setRequests((rs) => rs.map((r) => (r.id === updated.id ? updated : r)));
    // Quota changed: refetch balances + the quota table.
    setBalances({});
    setQuotaKey((k) => k + 1);
  }, []);

  async function approve(id: number) {
    if (acting[id]) return;
    setActing((a) => ({ ...a, [id]: true }));
    try {
      applyUpdate(await approveLeave(id));
      toast.success('Pengajuan berhasil disetujui.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyetujui.');
    } finally {
      setActing((a) => {
        const next = { ...a };
        delete next[id];
        return next;
      });
    }
  }

  function closeReject() {
    if (rejectingSubmit) return;
    setRejecting(null);
    setRejectReason('');
  }

  async function confirmReject() {
    if (!rejecting || rejectingSubmit) return;
    if (!rejectReason.trim()) {
      toast.error('Alasan penolakan wajib diisi.');
      return;
    }
    setRejectingSubmit(true);
    try {
      applyUpdate(await rejectLeave(rejecting.id, rejectReason.trim()));
      toast.success('Pengajuan berhasil ditolak.');
      setRejecting(null);
      setRejectReason('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menolak.');
    } finally {
      setRejectingSubmit(false);
    }
  }

  if (loading) {
    return (
      <div className='space-y-2 p-4 md:p-8'>
        <Skeleton className='h-8 w-64' />
        <Skeleton className='h-40 w-full' />
      </div>
    );
  }

  return (
    <div className='flex flex-1 flex-col gap-6 p-4 md:p-8'>
      <div className='flex flex-wrap items-end justify-between gap-4'>
        <div>
          <Link href='/dashboard/management' className='text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm'>
            <Icons.arrowLeft className='size-4' />
            Kembali ke dashboard
          </Link>
          <h2 className='mt-3 text-3xl font-bold tracking-tight'>Persetujuan izin &amp; cuti</h2>
          <p className='text-muted-foreground mt-1'>
            {isGm
              ? 'Pengajuan dari tim Anda, plus sisa kuota cuti seluruh karyawan aktif.'
              : 'Pengajuan dari karyawan yang melapor langsung ke Anda.'}
          </p>
        </div>
        <span
          className={cn(
            'inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold',
            awaitingMe > 0
              ? 'bg-orange-500/10 text-orange-700 dark:text-orange-300'
              : 'bg-primary/10 text-primary'
          )}
        >
          <span className='size-2 rounded-full bg-current' />
          {awaitingMe} menunggu keputusan Anda
        </span>
      </div>

      <Card className='gap-0 overflow-hidden py-0'>
        <div className='flex flex-wrap items-center justify-between gap-3 px-6 py-5'>
          <h3 className='text-lg font-semibold'>Pengajuan tim</h3>
          <div className='bg-muted flex rounded-lg p-1' role='tablist'>
            {(
              [
                ['PENDING', `Menunggu · ${pending.length}`],
                ['HISTORY', `Riwayat · ${history.length}`]
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type='button'
                role='tab'
                aria-selected={tab === value}
                onClick={() => setTab(value)}
                className={cn(
                  'rounded-md px-3.5 py-1.5 text-sm transition-colors',
                  tab === value ? 'bg-background font-semibold shadow-sm' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className='border-t'>
          {tab === 'PENDING' ? (
            pending.length === 0 ? (
              <div className='flex flex-col items-center gap-2 px-6 py-14 text-center'>
                <span className='bg-primary/10 text-primary mb-2 flex size-14 items-center justify-center rounded-2xl'>
                  <Icons.check className='size-6' />
                </span>
                <p className='font-semibold'>Tidak ada pengajuan yang menunggu</p>
                <p className='text-muted-foreground max-w-sm text-sm'>
                  Pengajuan dari tim yang melapor langsung ke Anda akan muncul di sini.
                </p>
              </div>
            ) : (
              <ul className='divide-y'>
                {pending.map((r) => {
                  const { loading: balLoading, balance } = balanceFor(r);
                  const clash = overlaps(r);
                  return (
                    <li key={r.id} className='grid gap-6 px-6 py-6 xl:grid-cols-[minmax(0,1fr)_420px]'>
                      <div className='min-w-0 space-y-5'>
                        <div className='flex flex-wrap items-start justify-between gap-3'>
                          <div className='flex items-center gap-3'>
                            <span className='bg-primary/10 text-primary flex size-12 shrink-0 items-center justify-center rounded-full font-semibold'>
                              {initials(r.employee_name)}
                            </span>
                            <div>
                              <p className='text-lg font-semibold'>{r.employee_name}</p>
                              <p className='text-muted-foreground text-sm'>
                                Atasan {r.employee_manager_name || '—'}
                              </p>
                            </div>
                          </div>
                          <StatusPill status={r.status} />
                        </div>
                        <dl className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
                          <div>
                            <dt className='text-muted-foreground text-sm'>Jenis</dt>
                            <dd className='mt-1'>
                              {r.leave_type_name}
                              {r.leave_type_kind === 'PERMISSION' && <span className='text-muted-foreground text-sm'> (Izin)</span>}
                            </dd>
                          </div>
                          <div>
                            <dt className='text-muted-foreground text-sm'>Durasi</dt>
                            <dd className='mt-1 font-semibold'>{formatDays(r.total_days)} hari kerja</dd>
                          </div>
                          <div className='min-w-0'>
                            <dt className='text-muted-foreground text-sm'>Alasan</dt>
                            <dd className='mt-1 break-words'>{r.reason || '—'}</dd>
                          </div>
                          <div>
                            <dt className='text-muted-foreground text-sm'>Dokumen</dt>
                            <dd className='mt-1'>
                              {r.attachment_url ? (
                                <a
                                  href={r.attachment_url}
                                  target='_blank'
                                  rel='noreferrer'
                                  className='text-primary inline-flex items-center gap-1.5 font-medium hover:underline'
                                >
                                  <Icons.paperclip className='size-4' />
                                  Lihat lampiran
                                </a>
                              ) : (
                                <span className='text-muted-foreground'>—</span>
                              )}
                            </dd>
                          </div>
                        </dl>
                        <div className='space-y-2'>
                          <p className='text-muted-foreground text-sm'>Tanggal</p>
                          <DayChips r={r} />
                          {clash.length === 0 ? (
                            <p className='text-primary flex items-center gap-1.5 text-sm'>
                              <Icons.check className='size-4' />
                              Tidak ada anggota tim lain yang cuti di tanggal ini
                            </p>
                          ) : (
                            <p className='flex items-center gap-1.5 text-sm text-orange-700 dark:text-orange-300'>
                              <Icons.alertCircle className='size-4' />
                              Juga cuti/izin di tanggal ini: {[...new Set(clash)].join(', ')}
                            </p>
                          )}
                        </div>
                      </div>
                      <ImpactPanel
                        r={r}
                        balance={balance}
                        loading={balLoading}
                        acting={!!acting[r.id]}
                        onApprove={() => approve(r.id)}
                        onReject={() => setRejecting(r)}
                      />
                    </li>
                  );
                })}
              </ul>
            )
          ) : history.length === 0 ? (
            <p className='text-muted-foreground px-6 py-10 text-center text-sm'>Belum ada riwayat pengajuan tim.</p>
          ) : (
            <div className='overflow-x-auto'>
              <table className='w-full text-sm'>
                <thead className='bg-muted/40 text-muted-foreground text-left'>
                  <tr>
                    <th className='px-6 py-3 font-medium'>Karyawan</th>
                    <th className='px-4 py-3 font-medium'>Jenis</th>
                    <th className='px-4 py-3 font-medium'>Tanggal</th>
                    <th className='px-4 py-3 font-medium'>Durasi</th>
                    <th className='px-6 py-3 text-right font-medium'>Status</th>
                  </tr>
                </thead>
                <tbody className='divide-y'>
                  {history.map((r) => (
                    <tr key={r.id} className='align-top'>
                      <td className='px-6 py-3.5'>
                        <p className='font-medium'>{r.employee_name}</p>
                        {r.approver_name && <p className='text-muted-foreground text-xs'>oleh {r.approver_name}</p>}
                      </td>
                      <td className='px-4 py-3.5'>
                        {r.leave_type_name}
                        {r.status === 'REJECTED' && r.rejection_reason && (
                          <p className='text-destructive max-w-64 text-xs'>Alasan ditolak: {r.rejection_reason}</p>
                        )}
                      </td>
                      <td className='max-w-64 px-4 py-3.5'>{r.leave_dates_display || `${r.start_date} — ${r.end_date}`}</td>
                      <td className='px-4 py-3.5 whitespace-nowrap tabular-nums'>{formatDays(r.total_days)} hari</td>
                      <td className='px-6 py-3.5 text-right'>
                        <StatusPill status={r.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>

      <TeamQuotaCard
        key={quotaKey}
        title={isGm ? 'Sisa kuota cuti karyawan' : 'Sisa kuota cuti tim'}
        description={
          isGm
            ? 'Per hari ini, untuk seluruh karyawan aktif. Cek sebelum menyetujui.'
            : 'Per hari ini, untuk karyawan yang melapor langsung ke Anda. Cek sebelum menyetujui.'
        }
        emptyText={isGm ? 'Tidak ada karyawan aktif.' : 'Belum ada karyawan aktif yang melapor langsung ke Anda.'}
      />

      {/* Reject pop-up (centered modal; click outside / Esc to close) */}
      {rejecting && (
        <div
          role='dialog'
          aria-modal='true'
          aria-labelledby='reject-title'
          className='fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4'
          onClick={closeReject}
          onKeyDown={(e) => e.key === 'Escape' && closeReject()}
        >
          <Card className='w-full max-w-md shadow-xl' onClick={(e) => e.stopPropagation()}>
            <CardHeader>
              <CardTitle id='reject-title'>Tolak Pengajuan</CardTitle>
              <p className='text-muted-foreground text-sm'>
                {rejecting.employee_name} · {rejecting.leave_type_name} ·{' '}
                {rejecting.leave_dates_display || `${rejecting.start_date} — ${rejecting.end_date}`}
              </p>
            </CardHeader>
            <CardContent className='space-y-4'>
              <div className='space-y-1.5'>
                <Label className='text-xs'>
                  Alasan Penolakan <span className='text-destructive'>*</span>
                </Label>
                <Input
                  autoFocus
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && confirmReject()}
                  placeholder='Alasan penolakan'
                />
                <p className='text-muted-foreground text-xs'>Alasan akan dikirim ke karyawan melalui notifikasi & email.</p>
              </div>
              <div className='flex justify-end gap-2'>
                <Button variant='ghost' disabled={rejectingSubmit} onClick={closeReject}>
                  Batal
                </Button>
                <Button variant='destructive' disabled={rejectingSubmit} onClick={confirmReject}>
                  {rejectingSubmit ? 'Memproses...' : 'Tolak Pengajuan'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
