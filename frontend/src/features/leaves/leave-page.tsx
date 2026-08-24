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
import { useAuth } from '@/lib/auth/auth-provider';
import {
  approveLeave,
  cancelLeave,
  listBalances,
  listLeaveRequests,
  listLeaveTypes,
  rejectLeave,
  type LeaveBalance,
  type LeaveRequest,
  type LeaveType
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
  const fEmployee = searchParams.get('employee') ?? '';

  function setFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams);
    if (value) params.set(key, value);
    else params.delete(key);
    router.replace(`/dashboard/leave${params.size ? `?${params}` : ''}`);
  }

  const { user } = useAuth();
  const role = user?.role;
  const isApprover = role === 'admin' || role === 'hr_staff' || role === 'hr_lead' || role === 'management';
  const isAdmin = role === 'admin' || role === 'hr_staff' || role === 'hr_lead';

  const [types, setTypes] = useState<LeaveType[]>([]);
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [rejecting, setRejecting] = useState<LeaveRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [employees, setEmployees] = useState<Employee[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (fStatus) params.status = fStatus;
    if (fType) params.leave_type = fType;
    if (fEmployee) params.employee = fEmployee;
    const [t, r] = await Promise.all([listLeaveTypes(), listLeaveRequests(params)]);
    setTypes(t);
    setRequests(r);
    setLoading(false);
  }, [fStatus, fType, fEmployee]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!isAdmin) return;
    listEmployees({ employment_status: 'ACTIVE', page_size: '1000' })
      .then((d) => setEmployees(d.results))
      .catch(() => {});
  }, [isAdmin]);

  async function approve(id: number) {
    try {
      await approveLeave(id);
      toast.success('Pengajuan disetujui.');
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyetujui.');
    }
  }

  async function confirmReject() {
    if (!rejecting) return;
    if (!rejectReason.trim()) {
      toast.error('Alasan penolakan wajib diisi.');
      return;
    }
    try {
      await rejectLeave(rejecting.id, rejectReason.trim());
      toast.success('Pengajuan ditolak.');
      setRejecting(null);
      setRejectReason('');
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menolak.');
    }
  }

  async function cancel(id: number) {
    try {
      await cancelLeave(id);
      toast.success('Pengajuan dibatalkan.');
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal membatalkan.');
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
        <Button onClick={() => router.push('/dashboard/leave/new')}>Ajukan Cuti</Button>
      </div>

      {isAdmin && balances.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Sisa Kuota</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Jenis</TableHead>
                  <TableHead>Tahun</TableHead>
                  <TableHead>Dialokasikan</TableHead>
                  <TableHead>Terpakai</TableHead>
                  <TableHead>Sisa</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {balances.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>{b.leave_type_name}</TableCell>
                    <TableCell>{b.year}</TableCell>
                    <TableCell>{b.allocated_days}</TableCell>
                    <TableCell>{b.used_days}</TableCell>
                    <TableCell>{b.remaining_days}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
            <select aria-label='Filter jenis cuti' className='border-input h-8 rounded-lg border bg-transparent px-2.5 text-sm' value={fType} onChange={(e) => setFilter('leave_type', e.target.value)}>
              <option value=''>Semua Jenis</option>
              {types.map((t) => (
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
            {(fStatus || fType || fEmployee) && (
              <Button
                variant='ghost'
                size='sm'
                onClick={() => {
                  const params = new URLSearchParams(searchParams);
                  for (const k of ['status', 'leave_type', 'employee']) params.delete(k);
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
                <TableHead>Status</TableHead>
                <TableHead>Alasan</TableHead>
                <TableHead className='text-right'>Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.employee_name}</TableCell>
                  <TableCell>{r.leave_type_name}</TableCell>
                  <TableCell>
                    {r.start_date} — {r.end_date}
                  </TableCell>
                  <TableCell>{r.total_days}</TableCell>
                  <TableCell>
                    <StatusBadge status={r.status} />
                  </TableCell>
                  <TableCell className='max-w-48 truncate'>{r.reason || '-'}</TableCell>
                  <TableCell className='text-right'>
                    <div className='flex items-center justify-end gap-2'>
                      {r.attachment_url && (
                        <a href={r.attachment_url} target='_blank' rel='noreferrer' className='text-primary text-sm font-medium hover:underline'>
                          Lampiran
                        </a>
                      )}
                      {r.status === 'PENDING' && isApprover && (
                        <>
                          <Button variant='outline' size='sm' onClick={() => approve(r.id)}>
                            Setujui
                          </Button>
                          <Button variant='ghost' size='sm' onClick={() => setRejecting(r)}>
                            Tolak
                          </Button>
                        </>
                      )}
                      {r.status === 'PENDING' && !isApprover && (
                        <Button variant='ghost' size='sm' onClick={() => cancel(r.id)}>
                          Batalkan
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {requests.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className='text-muted-foreground py-10 text-center'>
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
              <Button onClick={confirmReject}>Konfirmasi Tolak</Button>
              <Button variant='ghost' onClick={() => setRejecting(null)}>
                Batal
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
