'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'react-toastify';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { QuotaAdjustmentPanel } from './quota-adjustment-panel';
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

function StatusBadge({ status }: { status: string }) {
  return <Badge variant={STATUS_VARIANT[status] ?? 'secondary'}>{status}</Badge>;
}

export function LeavePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fStatus = searchParams.get('status') ?? '';
  const fType = searchParams.get('leave_type') ?? '';
  const fKind = searchParams.get('kind') ?? '';
  const fEmployee = searchParams.get('employee') ?? '';

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
  }, [fStatus, fType, fKind, fEmployee]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!isAdmin) return;
    listEmployees({ employment_status: 'ACTIVE', page_size: '1000' })
      .then((d) => {
        setEmployees(d.results);
        // Default to first employee; show their balances.
        if (d.results.length > 0) setBalanceEmpId((prev) => prev ?? d.results[0].id);
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

  if (loading) {
    return (
      <div className='space-y-2 p-4 md:p-6'>
        <Skeleton className='h-8 w-64' />
        <Skeleton className='h-40 w-full' />
      </div>
    );
  }

  return (
    <div className='flex flex-1 flex-col gap-4 p-4 md:p-6'>
      <div className='flex items-center justify-between'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>Izin & Cuti</h2>
          <p className='text-muted-foreground text-sm'>Kelola pengajuan izin dan cuti.</p>
        </div>
      </div>

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Kuota Karyawan</CardTitle>
          </CardHeader>
          <CardContent className='space-y-3'>
            <div className='flex flex-wrap items-center gap-2'>
              <select
                aria-label='Pilih karyawan'
                className='border-input h-9 rounded-lg border bg-transparent px-2.5 text-sm'
                value={balanceEmpId ?? ''}
                onChange={(e) => setBalanceEmpId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value=''>Pilih Karyawan</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.full_name}
                  </option>
                ))}
              </select>
              <select
                aria-label='Pilih tahun'
                className='border-input h-9 rounded-lg border bg-transparent px-2.5 text-sm'
                value={balanceYear}
                onChange={(e) => setBalanceYear(Number(e.target.value))}
              >
                {[2024, 2025, 2026, 2027].map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
            {balanceLoading ? (
              <Skeleton className='h-32 w-full' />
            ) : balanceEmpId && balances.length === 0 ? (
              <p className='text-muted-foreground text-sm'>Tidak ada jenis cuti berkuota yang aktif.</p>
            ) : balanceEmpId ? (
              <>
                <p className='text-sm font-medium text-slate-700'>{employees.find((e) => e.id === balanceEmpId)?.full_name}</p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Jenis</TableHead>
                      <TableHead>Tahun</TableHead>
                      <TableHead>Kuota</TableHead>
                      <TableHead>Adjustment</TableHead>
                      <TableHead>Terpakai</TableHead>
                      <TableHead>Pending</TableHead>
                      <TableHead>Sisa</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {balances.map((b) => {
                      const deductedBy = types.filter((t) => t.deducts_from === b.leave_type).map((t) => t.name);
                      const notEligible =
                        b.leave_type_code === 'ANNUAL' && b.allocated_days === 0 && b.adjustment_days === 0;
                      return (
                        <TableRow key={b.leave_type}>
                          <TableCell>
                            {b.leave_type_name}
                            {deductedBy.length > 0 && (
                              <p className='text-muted-foreground text-xs'>termasuk {deductedBy.join(', ')}</p>
                            )}
                            {notEligible && (
                              <p className='text-muted-foreground text-xs'>belum berhak (masa kerja &lt; 3 bulan)</p>
                            )}
                          </TableCell>
                          <TableCell>{b.year}</TableCell>
                          <TableCell>{formatDays(b.allocated_days)}</TableCell>
                          <TableCell>
                            {b.adjustment_days > 0 ? '+' : ''}
                            {formatDays(b.adjustment_days)}
                          </TableCell>
                          <TableCell>{formatDays(b.used_days)}</TableCell>
                          <TableCell>{formatDays(b.pending_days)}</TableCell>
                          <TableCell className='font-medium'>{formatDays(b.remaining_days)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                <p className='text-muted-foreground text-xs'>
                  Sisa = Kuota (termasuk carry-forward) + Adjustment − Terpakai. Pending belum memotong kuota.
                </p>
              </>
            ) : null}
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

      <Card>
        <CardHeader>
          <CardTitle>{isApprover ? 'Semua Pengajuan' : 'Pengajuan Saya'}</CardTitle>
        </CardHeader>
        <CardContent className='space-y-3'>
          <div className='flex flex-wrap items-center gap-2'>
            <select aria-label='Filter status' className='border-input h-8 rounded-lg border bg-transparent px-2.5 text-sm' value={fStatus} onChange={(e) => setFilter('status', e.target.value)}>
              <option value=''>Semua Status</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              aria-label='Filter jenis'
              className='border-input h-8 rounded-lg border bg-transparent px-2.5 text-sm'
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
              <option value=''>Semua Jenis</option>
              <option value='LEAVE'>Cuti</option>
              <option value='PERMISSION'>Izin</option>
            </select>
            <select
              aria-label='Filter kategori'
              className='border-input h-8 rounded-lg border bg-transparent px-2.5 text-sm'
              value={fType}
              onChange={(e) => setFilter('leave_type', e.target.value)}
            >
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
              <select aria-label='Filter karyawan' className='border-input h-8 rounded-lg border bg-transparent px-2.5 text-sm' value={fEmployee} onChange={(e) => setFilter('employee', e.target.value)}>
                <option value=''>Semua Karyawan</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.full_name}
                  </option>
                ))}
              </select>
            )}
            {(fStatus || fKind || fType || fEmployee) && (
              <Button
                variant='ghost'
                size='sm'
                onClick={() => {
                  const params = new URLSearchParams(searchParams);
                  for (const k of ['status', 'kind', 'leave_type', 'employee']) params.delete(k);
                  router.replace(`/dashboard/leave${params.size ? `?${params}` : ''}`);
                }}
              >
                Reset
              </Button>
            )}
          </div>

          {loading ? (
            <div className='space-y-2'>
              <Skeleton className='h-8 w-full' />
              <Skeleton className='h-8 w-full' />
              <Skeleton className='h-8 w-full' />
            </div>
          ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Karyawan</TableHead>
                <TableHead>Jenis</TableHead>
                <TableHead>Periode</TableHead>
                <TableHead>Hari</TableHead>
                <TableHead>Status Atasan</TableHead>
                <TableHead>Alasan</TableHead>
                <TableHead>Lampiran</TableHead>
                <TableHead className='text-right'>Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.employee_name}</TableCell>
                  <TableCell>
                    {r.leave_type_name}
                    {r.leave_type_kind === 'PERMISSION' && (
                      <span className='text-muted-foreground ml-1 text-xs'>(Izin)</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {r.leave_dates_display || `${r.start_date} — ${r.end_date}`}
                  </TableCell>
                  <TableCell>{formatDays(r.total_days)}</TableCell>
                  <TableCell>
                    <StatusBadge status={r.status} />
                  </TableCell>
                  <TableCell className='max-w-48 whitespace-normal break-words'>{r.reason || '-'}</TableCell>
                  <TableCell className='text-right'>
                    <div className='flex items-center justify-end gap-2'>
                      {r.attachment_url && (
                        <Button variant='outline' size='sm' render={<a href={r.attachment_url} target='_blank' rel='noreferrer' />}>
                          Lampiran
                        </Button>
                      )}
                      {r.status === 'PENDING' && canApproveReject && (
                        <>
                          <Button variant='success' size='sm' disabled={acting[r.id]} onClick={() => approve(r.id)}>
                            {acting[r.id] ? 'Memproses...' : 'Setujui'}
                          </Button>
                          <Button variant='destructive' size='sm' disabled={acting[r.id]} onClick={() => setRejecting(r)}>
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
                        <Button variant='destructive' size='sm' onClick={() => setDeleting(r)}>
                          Hapus
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {requests.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className='text-muted-foreground py-10 text-center'>
                    Tidak ada pengajuan yang cocok dengan filter.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          )}
        </CardContent>
      </Card>

      {rejecting && (
        <Card>
          <CardHeader>
            <CardTitle>Tolak Pengajuan</CardTitle>
          </CardHeader>
          <CardContent className='space-y-3'>
            <div>
              <Label className='text-xs'>Alasan Penolakan (wajib)</Label>
              <Input
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder='Alasan penolakan'
              />
            </div>
            <div className='flex gap-2'>
              <Button disabled={rejectingSubmit} onClick={confirmReject}>
                {rejectingSubmit ? 'Memproses...' : 'Konfirmasi Tolak'}
              </Button>
              <Button variant='ghost' disabled={rejectingSubmit} onClick={() => setRejecting(null)}>
                Batal
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      {deleting && (
        <Card>
          <CardHeader>
            <CardTitle>Hapus Permanen</CardTitle>
          </CardHeader>
          <CardContent className='space-y-3'>
            <p className='text-muted-foreground text-sm'>
              Yakin hapus permanen pengajuan {deleting.leave_type_name} ({deleting.leave_dates_display || `${deleting.start_date} — ${deleting.end_date}`})? Tindakan ini tidak dapat dibatalkan.
            </p>
            <div className='flex gap-2'>
              <Button variant='destructive' disabled={deletingSubmit} onClick={confirmHardDelete}>
                {deletingSubmit ? 'Menghapus...' : 'Hapus Permanen'}
              </Button>
              <Button variant='ghost' disabled={deletingSubmit} onClick={() => setDeleting(null)}>
                Batal
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
