'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'react-toastify';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';
import { AllQuotaTable } from './all-quota-table';
import { QuotaAdjustmentPanel } from './quota-adjustment-panel';
import { LeaveCategoryManager } from './leave-category-manager';
import { useAuth } from '@/lib/auth/auth-provider';
import {
  approveLeave,
  cancelLeave,
  hardDeleteLeave,
  formatDays,
  getBalanceSummary,
  listLeaveRequests,
  listLeaveTypes,
  rejectLeave,
  type LeaveRequest,
  type LeaveType,
  type MyBalance
} from '@/lib/leaves';
import { listEmployees, type Employee } from '@/lib/employees';

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  PENDING: 'secondary',
  APPROVED: 'default',
  REJECTED: 'destructive',
  CANCELLED: 'outline',
  DRAFT: 'outline'
};

const STATUS_OPTIONS = ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'];

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft',
  PENDING: 'Menunggu',
  APPROVED: 'Disetujui',
  REJECTED: 'Ditolak',
  CANCELLED: 'Dibatalkan'
};

function StatusBadge({ status }: { status: string }) {
  return <Badge variant={STATUS_VARIANT[status] ?? 'secondary'}>{STATUS_LABEL[status] ?? status}</Badge>;
}

type Tab = 'requests' | 'quota' | 'categories';

const SELECT = 'border-input h-9 rounded-lg border bg-transparent px-2.5 text-sm';

export function LeavePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fStatus = searchParams.get('status') ?? '';
  const fType = searchParams.get('leave_type') ?? '';
  const fKind = searchParams.get('kind') ?? '';
  const fEmployee = searchParams.get('employee') ?? '';
  const tabParam = searchParams.get('tab');

  function setFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams);
    if (value) params.set(key, value);
    else params.delete(key);
    router.replace(`/dashboard/leave${params.size ? `?${params}` : ''}`);
  }

  const { user } = useAuth();
  const role = user?.role;
  const isApprover = role === 'admin' || role === 'hr_staff' || role === 'hr_lead' || role === 'management' || role === 'general_manager';
  // Reporting To is the primary approver; HR Staff/HR Lead may act as fallback
  // (authorization enforced by the backend).
  const canApproveReject =
    role === 'management' || role === 'general_manager' || role === 'hr_staff' || role === 'hr_lead';
  const isAdmin = role === 'admin' || role === 'hr_staff' || role === 'hr_lead';
  const canHardDelete = role === 'admin'; // backend: ADMIN/superadmin only

  const [types, setTypes] = useState<LeaveType[]>([]);
  const [balances, setBalances] = useState<MyBalance[]>([]);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  // Full-page skeleton only on first load; later filter changes keep the layout.
  const [initialized, setInitialized] = useState(false);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceEmpId, setBalanceEmpId] = useState<number | null>(null);
  const [balanceYear, setBalanceYear] = useState(new Date().getFullYear());
  const [rejecting, setRejecting] = useState<LeaveRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectingSubmit, setRejectingSubmit] = useState(false);
  const [deleting, setDeleting] = useState<LeaveRequest | null>(null);
  const [deletingSubmit, setDeletingSubmit] = useState(false);
  const [acting, setActing] = useState<Record<number, boolean>>({});
  const [employees, setEmployees] = useState<Employee[]>([]);

  const applyUpdate = useCallback((updated: LeaveRequest) => {
    setRequests((rs) => rs.map((r) => (r.id === updated.id ? updated : r)));
  }, []);

  const reloadBalances = useCallback(
    async (employeeId?: number, year?: number) => {
      if (!isAdmin) return;
      const emp = employeeId ?? balanceEmpId;
      const yr = year ?? balanceYear;
      if (!emp) {
        setBalances([]);
        return;
      }
      setBalanceLoading(true);
      try {
        // Computed by the quota engine — shown even without any leave history.
        setBalances(await getBalanceSummary(emp, yr));
      } catch {
        /* non-fatal */
      } finally {
        setBalanceLoading(false);
      }
    },
    [isAdmin, balanceEmpId, balanceYear]
  );

  const load = useCallback(async () => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (fStatus) params.status = fStatus;
    if (fKind) params.leave_type__kind = fKind;
    if (fType) params.leave_type = fType;
    if (fEmployee) params.employee = fEmployee;
    const [t, r] = await Promise.all([listLeaveTypes(), listLeaveRequests(params)]);
    setTypes(t);
    setRequests(r);
    setLoading(false);
    setInitialized(true);
  }, [fStatus, fType, fKind, fEmployee]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!isAdmin) return;
    listEmployees({ employment_status: 'ACTIVE', page_size: '1000' })
      .then((d) => {
        // Default view is "Semua Karyawan" (paginated); pick one to drill in.
        setEmployees(d.results);
      })
      .catch(() => {});
  }, [isAdmin]);

  useEffect(() => {
    if (isAdmin && balanceEmpId) reloadBalances();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, balanceEmpId, balanceYear]);

  async function approve(id: number) {
    if (acting[id]) return; // prevent double-click
    setActing((a) => ({ ...a, [id]: true }));
    try {
      const updated = await approveLeave(id);
      applyUpdate(updated);
      toast.success('Pengajuan berhasil disetujui.');
      reloadBalances();
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

  async function confirmReject() {
    if (!rejecting || rejectingSubmit) return;
    if (!rejectReason.trim()) {
      toast.error('Alasan penolakan wajib diisi.');
      return;
    }
    setRejectingSubmit(true);
    try {
      const updated = await rejectLeave(rejecting.id, rejectReason.trim());
      applyUpdate(updated);
      toast.success('Pengajuan berhasil ditolak.');
      setRejecting(null);
      setRejectReason('');
      reloadBalances();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menolak.');
    } finally {
      setRejectingSubmit(false);
    }
  }

  async function cancel(id: number) {
    if (acting[id]) return;
    setActing((a) => ({ ...a, [id]: true }));
    try {
      const updated = await cancelLeave(id);
      applyUpdate(updated);
      toast.success('Pengajuan dibatalkan.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal membatalkan.');
    } finally {
      setActing((a) => {
        const next = { ...a };
        delete next[id];
        return next;
      });
    }
  }

  async function confirmHardDelete() {
    if (!deleting || deletingSubmit) return;
    setDeletingSubmit(true);
    try {
      await hardDeleteLeave(deleting.id);
      toast.success('Data cuti dihapus permanen.');
      setRequests((rs) => rs.filter((r) => r.id !== deleting.id));
      setDeleting(null);
      reloadBalances();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menghapus.');
    } finally {
      setDeletingSubmit(false);
    }
  }

  const tab: Tab = isAdmin && (tabParam === 'quota' || tabParam === 'categories') ? tabParam : 'requests';
  const activeFilters = [fStatus, fKind, fType, fEmployee].filter(Boolean).length;
  const pendingCount = requests.filter((r) => r.status === 'PENDING').length;

  function setTab(next: Tab) {
    setFilter('tab', next === 'requests' ? '' : next);
  }

  function resetFilters() {
    const params = new URLSearchParams(searchParams);
    for (const k of ['status', 'kind', 'leave_type', 'employee']) params.delete(k);
    router.replace(`/dashboard/leave${params.size ? `?${params}` : ''}`);
  }

  if (!initialized) {
    return (
      <div className='flex flex-1 flex-col gap-4 p-4 md:p-6'>
        <Skeleton className='h-8 w-64' />
        <Skeleton className='h-10 w-80' />
        <Skeleton className='h-96 w-full' />
      </div>
    );
  }

  const tabs: { key: Tab; label: string; icon: keyof typeof Icons }[] = [
    { key: 'requests', label: isApprover ? 'Pengajuan' : 'Pengajuan Saya', icon: 'leave' },
    ...(isAdmin
      ? [
          { key: 'quota' as const, label: 'Kuota Karyawan', icon: 'calendar' as const },
          { key: 'categories' as const, label: 'Kategori', icon: 'adjustments' as const }
        ]
      : [])
  ];

  return (
    <div className='flex flex-1 flex-col gap-5 p-4 md:p-6'>
      {/* Header */}
      <div>
        <h2 className='text-2xl font-bold tracking-tight'>Izin & Cuti</h2>
        <p className='text-muted-foreground text-sm'>
          {isAdmin ? 'Kelola pengajuan, kuota, dan kategori izin/cuti karyawan.' : 'Kelola pengajuan izin dan cuti.'}
        </p>
      </div>

      {/* Tabs */}
      {tabs.length > 1 && (
        <div className='flex gap-1 overflow-x-auto border-b'>
          {tabs.map((t) => {
            const Icon = Icons[t.icon];
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                type='button'
                onClick={() => setTab(t.key)}
                className={cn(
                  '-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                  active
                    ? 'border-primary text-foreground'
                    : 'text-muted-foreground hover:text-foreground border-transparent'
                )}
              >
                <Icon className='size-4' />
                {t.label}
                {t.key === 'requests' && pendingCount > 0 && (
                  <span className='rounded-full bg-amber-500/15 px-1.5 text-[11px] font-semibold text-amber-700 tabular-nums dark:text-amber-300'>
                    {pendingCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* --- Tab: Pengajuan ------------------------------------------------ */}
      {tab === 'requests' && (
        <Card className='gap-0 py-0'>
          <CardHeader className='flex flex-col gap-3 border-b py-4 lg:flex-row lg:items-center lg:justify-between'>
            <div>
              <CardTitle>{isApprover ? 'Semua Pengajuan' : 'Pengajuan Saya'}</CardTitle>
              <CardDescription>
                {requests.length} pengajuan{activeFilters > 0 ? ' sesuai filter' : ''}
              </CardDescription>
            </div>
            <div className='flex flex-wrap items-center gap-2'>
              <select aria-label='Filter status' className={SELECT} value={fStatus} onChange={(e) => setFilter('status', e.target.value)}>
                <option value=''>Semua Status</option>
                {STATUS_OPTIONS.map((st) => (
                  <option key={st} value={st}>
                    {STATUS_LABEL[st] ?? st}
                  </option>
                ))}
              </select>
              <select
                aria-label='Filter jenis'
                className={SELECT}
                value={fKind}
                onChange={(e) => {
                  const k = e.target.value;
                  const params = new URLSearchParams(searchParams);
                  if (k) params.set('kind', k);
                  else params.delete('kind');
                  params.delete('leave_type'); // reset category; may not belong to new kind
                  router.replace(`/dashboard/leave${params.size ? `?${params}` : ''}`);
                }}
              >
                <option value=''>Cuti & Izin</option>
                <option value='LEAVE'>Cuti</option>
                <option value='PERMISSION'>Izin</option>
              </select>
              <select aria-label='Filter kategori' className={SELECT} value={fType} onChange={(e) => setFilter('leave_type', e.target.value)}>
                <option value=''>Semua Kategori</option>
                {types
                  .filter((t) => !fKind || t.kind === fKind)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </select>
              {isApprover && (
                <select aria-label='Filter karyawan' className={cn(SELECT, 'max-w-48')} value={fEmployee} onChange={(e) => setFilter('employee', e.target.value)}>
                  <option value=''>Semua Karyawan</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.full_name}
                    </option>
                  ))}
                </select>
              )}
              {activeFilters > 0 && (
                <Button variant='ghost' size='sm' onClick={resetFilters}>
                  <Icons.close className='size-4' />
                  Reset
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className='p-0'>
            {loading ? (
              <div className='space-y-2 p-4'>
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className='h-12 w-full' />
                ))}
              </div>
            ) : requests.length === 0 ? (
              <div className='flex flex-col items-center gap-2 px-4 py-14 text-center'>
                <Icons.leave className='text-muted-foreground/50 size-8' />
                <p className='text-sm font-medium'>Tidak ada pengajuan</p>
                <p className='text-muted-foreground text-xs'>
                  {activeFilters > 0 ? 'Coba ubah atau reset filter.' : 'Belum ada pengajuan izin/cuti.'}
                </p>
              </div>
            ) : (
              <div className='overflow-x-auto'>
                <Table>
                  <TableHeader>
                    <TableRow className='bg-muted/40 hover:bg-muted/40'>
                      <TableHead className='pl-6'>Karyawan</TableHead>
                      <TableHead>Kategori</TableHead>
                      <TableHead>Tanggal</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Alasan</TableHead>
                      <TableHead className='pr-6 text-right'>Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {requests.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className='pl-6'>
                          <p className='font-medium'>{r.employee_name}</p>
                          <p className='text-muted-foreground text-xs'>
                            Atasan: {r.employee_manager_name || '-'}
                          </p>
                        </TableCell>
                        <TableCell>
                          <p>{r.leave_type_name}</p>
                          <p className='text-muted-foreground text-xs'>
                            {r.leave_type_kind === 'PERMISSION' ? 'Izin' : 'Cuti'}
                          </p>
                        </TableCell>
                        <TableCell className='max-w-56'>
                          <p className='whitespace-normal'>{r.leave_dates_display || `${r.start_date} — ${r.end_date}`}</p>
                          <p className='text-muted-foreground text-xs'>{formatDays(r.total_days)} hari</p>
                        </TableCell>
                        <TableCell className='max-w-48'>
                          <StatusBadge status={r.status} />
                          {r.status === 'REJECTED' && r.rejection_reason && (
                            <p
                              className='text-destructive mt-1 line-clamp-3 text-xs whitespace-normal break-words'
                              title={r.rejection_reason}
                            >
                              Alasan: {r.rejection_reason}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className='max-w-56'>
                          <p className='line-clamp-2 whitespace-normal break-words' title={r.reason || undefined}>
                            {r.reason || '-'}
                          </p>
                          {r.attachment_url && (
                            <a
                              href={r.attachment_url}
                              target='_blank'
                              rel='noreferrer'
                              className='text-primary mt-0.5 inline-flex items-center gap-1 text-xs font-medium hover:underline'
                            >
                              <Icons.paperclip className='size-3.5' />
                              Lampiran
                            </a>
                          )}
                        </TableCell>
                        <TableCell className='pr-6'>
                          <div className='flex items-center justify-end gap-1.5'>
                            {r.status === 'PENDING' && canApproveReject && r.can_decide !== false && (
                              <>
                                <Button variant='success' size='sm' disabled={acting[r.id]} onClick={() => approve(r.id)}>
                                  {acting[r.id] ? 'Memproses...' : 'Setujui'}
                                </Button>
                                <Button variant='outline' size='sm' disabled={acting[r.id]} onClick={() => setRejecting(r)}>
                                  Tolak
                                </Button>
                              </>
                            )}
                            {r.status === 'PENDING' && !isApprover && (
                              <Button variant='ghost' size='sm' disabled={acting[r.id]} onClick={() => cancel(r.id)}>
                                {acting[r.id] ? 'Memproses...' : 'Batalkan'}
                              </Button>
                            )}
                            {canHardDelete && (
                              <Button
                                variant='ghost'
                                size='icon'
                                className='text-muted-foreground hover:text-destructive size-8'
                                onClick={() => setDeleting(r)}
                                aria-label='Hapus permanen'
                                title='Hapus permanen'
                              >
                                <Icons.trash className='size-4' />
                              </Button>
                            )}
                            {r.status === 'PENDING' && canApproveReject && r.can_decide === false && (
                              <span className='text-muted-foreground text-xs'>Menunggu atasan langsung</span>
                            )}
                            {r.status !== 'PENDING' && !canHardDelete && (
                              <span className='text-muted-foreground text-xs'>-</span>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* --- Tab: Kuota Karyawan ------------------------------------------ */}
      {tab === 'quota' && isAdmin && (
        <Card>
          <CardHeader className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
            <div>
              <CardTitle>Kuota Karyawan</CardTitle>
              <CardDescription>
                {balanceEmpId
                  ? employees.find((e) => e.id === balanceEmpId)?.full_name
                  : 'Pilih karyawan untuk melihat detail dan menyesuaikan kuota.'}
              </CardDescription>
            </div>
            <div className='flex flex-wrap items-center gap-2'>
              {balanceEmpId && (
                <Button variant='ghost' size='sm' onClick={() => setBalanceEmpId(null)}>
                  <Icons.chevronLeft className='size-4' />
                  Semua
                </Button>
              )}
              <select
                aria-label='Pilih karyawan'
                className={cn(SELECT, 'max-w-56')}
                value={balanceEmpId ?? ''}
                onChange={(e) => setBalanceEmpId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value=''>Semua Karyawan</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.full_name}
                  </option>
                ))}
              </select>
              <select aria-label='Pilih tahun' className={SELECT} value={balanceYear} onChange={(e) => setBalanceYear(Number(e.target.value))}>
                {[2024, 2025, 2026, 2027].map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
          </CardHeader>
          <CardContent className='space-y-4'>
            {!balanceEmpId ? (
              <AllQuotaTable year={balanceYear} onSelect={setBalanceEmpId} />
            ) : balanceLoading ? (
              <Skeleton className='h-32 w-full' />
            ) : balances.length === 0 ? (
              <p className='text-muted-foreground text-sm'>Tidak ada jenis cuti berkuota yang aktif.</p>
            ) : (
              <>
                <div className='overflow-x-auto rounded-lg border'>
                  <Table>
                    <TableHeader>
                      <TableRow className='bg-muted/40 hover:bg-muted/40'>
                        <TableHead className='pl-4'>Jenis</TableHead>
                        <TableHead className='text-right'>Kuota</TableHead>
                        <TableHead className='text-right'>Adjustment</TableHead>
                        <TableHead className='text-right'>Terpakai</TableHead>
                        <TableHead className='text-right'>Pending</TableHead>
                        <TableHead className='pr-4 text-right'>Sisa</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {balances.map((b) => {
                        const deductedBy = types.filter((t) => t.deducts_from === b.leave_type).map((t) => t.name);
                        const notEligible =
                          b.leave_type_code === 'ANNUAL' && b.allocated_days === 0 && b.adjustment_days === 0;
                        return (
                          <TableRow key={b.leave_type}>
                            <TableCell className='pl-4'>
                              <p className='font-medium'>{b.leave_type_name}</p>
                              {deductedBy.length > 0 && (
                                <p className='text-muted-foreground text-xs'>termasuk {deductedBy.join(', ')}</p>
                              )}
                              {notEligible && (
                                <p className='text-muted-foreground text-xs'>belum berhak (masa kerja &lt; 3 bulan)</p>
                              )}
                            </TableCell>
                            <TableCell className='text-right tabular-nums'>{formatDays(b.allocated_days)}</TableCell>
                            <TableCell className='text-right tabular-nums'>
                              {b.adjustment_days > 0 ? '+' : ''}
                              {formatDays(b.adjustment_days)}
                            </TableCell>
                            <TableCell className='text-right tabular-nums'>{formatDays(b.used_days)}</TableCell>
                            <TableCell className='text-right tabular-nums'>{formatDays(b.pending_days)}</TableCell>
                            <TableCell className='pr-4 text-right font-semibold tabular-nums'>{formatDays(b.remaining_days)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                <p className='text-muted-foreground text-xs'>
                  Sisa = Kuota (termasuk carry-forward) + Adjustment − Terpakai. Pending belum memotong kuota.
                </p>
              </>
            )}
            {balanceEmpId && (
              <QuotaAdjustmentPanel
                employeeId={balanceEmpId}
                year={balanceYear}
                types={types}
                onSaved={() => reloadBalances()}
              />
            )}
          </CardContent>
        </Card>
      )}

      {/* --- Tab: Kategori ------------------------------------------------- */}
      {tab === 'categories' && isAdmin && <LeaveCategoryManager types={types} onChanged={setTypes} />}

      {/* Reject dialog */}
      <Sheet
        open={rejecting !== null}
        onOpenChange={(open) => {
          if (!open && !rejectingSubmit) {
            setRejecting(null);
            setRejectReason('');
          }
        }}
      >
        <SheetContent side='right' className='w-full sm:max-w-md'>
          <SheetHeader>
            <SheetTitle>Tolak Pengajuan</SheetTitle>
            <SheetDescription>
              {rejecting
                ? `${rejecting.employee_name} · ${rejecting.leave_type_name} · ${rejecting.leave_dates_display || `${rejecting.start_date} — ${rejecting.end_date}`}`
                : ''}
            </SheetDescription>
          </SheetHeader>
          <div className='space-y-1.5 px-4'>
            <Label className='text-xs'>
              Alasan Penolakan <span className='text-destructive'>*</span>
            </Label>
            <Input
              autoFocus
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder='Alasan penolakan'
            />
            <p className='text-muted-foreground text-xs'>Alasan akan dikirim ke karyawan melalui notifikasi & email.</p>
          </div>
          <SheetFooter>
            <Button variant='destructive' disabled={rejectingSubmit} onClick={confirmReject}>
              {rejectingSubmit ? 'Memproses...' : 'Tolak Pengajuan'}
            </Button>
            <Button variant='ghost' disabled={rejectingSubmit} onClick={() => setRejecting(null)}>
              Batal
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Hard delete dialog */}
      <Sheet open={deleting !== null} onOpenChange={(open) => !open && !deletingSubmit && setDeleting(null)}>
        <SheetContent side='right' className='w-full sm:max-w-md'>
          <SheetHeader>
            <SheetTitle>Hapus Permanen</SheetTitle>
            <SheetDescription>Tindakan ini tidak dapat dibatalkan.</SheetDescription>
          </SheetHeader>
          <p className='px-4 text-sm'>
            Hapus permanen pengajuan <span className='font-medium'>{deleting?.leave_type_name}</span> milik{' '}
            <span className='font-medium'>{deleting?.employee_name}</span> (
            {deleting ? deleting.leave_dates_display || `${deleting.start_date} — ${deleting.end_date}` : ''})? Kuota yang
            sudah terpotong akan dikembalikan.
          </p>
          <SheetFooter>
            <Button variant='destructive' disabled={deletingSubmit} onClick={confirmHardDelete}>
              {deletingSubmit ? 'Menghapus...' : 'Hapus Permanen'}
            </Button>
            <Button variant='ghost' disabled={deletingSubmit} onClick={() => setDeleting(null)}>
              Batal
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
