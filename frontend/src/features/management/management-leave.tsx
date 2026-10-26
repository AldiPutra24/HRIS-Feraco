'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAuth } from '@/lib/auth/auth-provider';
import { TeamQuotaCard } from './team-quota-card';
import {
  approveLeave,
  formatDays,
  listLeaveRequests,
  rejectLeave,
  type LeaveRequest
} from '@/lib/leaves';

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

export function ManagementLeave() {
  const { user } = useAuth();
  // Backend scopes the quota table: GM = all active employees, Management = direct reports.
  const isGm = user?.role === 'general_manager';
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<Record<number, boolean>>({});
  const [rejecting, setRejecting] = useState<LeaveRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectingSubmit, setRejectingSubmit] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Backend already scopes MANAGEMENT to their direct reports + own.
      setRequests(await listLeaveRequests());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal memuat pengajuan.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const applyUpdate = useCallback((updated: LeaveRequest) => {
    setRequests((rs) => rs.map((r) => (r.id === updated.id ? updated : r)));
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
      <div className='space-y-2 p-4 md:p-6'>
        <Skeleton className='h-8 w-64' />
        <Skeleton className='h-40 w-full' />
      </div>
    );
  }

  return (
    <div className='flex flex-1 flex-col gap-4 p-4 md:p-6'>
      <div>
        <h2 className='text-2xl font-bold tracking-tight'>Persetujuan Izin &amp; Cuti</h2>
        <p className='text-muted-foreground text-sm'>Pengajuan dari tim yang Anda kelola.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Semua Pengajuan Tim</CardTitle>
        </CardHeader>
        <CardContent className='p-0'>
          {requests.length === 0 ? (
            <p className='text-muted-foreground p-6 text-center'>Tidak ada pengajuan dari tim.</p>
          ) : (
            <div className='overflow-x-auto'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Karyawan</TableHead>
                    <TableHead>Atasan</TableHead>
                    <TableHead>Jenis</TableHead>
                    <TableHead>Periode</TableHead>
                    <TableHead>Hari</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Alasan</TableHead>
                    <TableHead>Dokumen</TableHead>
                    <TableHead className='text-right'>Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requests.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{r.employee_name}</TableCell>
                      <TableCell>{r.employee_manager_name || '-'}</TableCell>
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
                      <TableCell>
                        {r.attachment_url ? (
                          <Button variant='outline' size='sm' render={<a href={r.attachment_url} target='_blank' rel='noreferrer' />}>
                            Lampiran
                          </Button>
                        ) : (
                          '-'
                        )}
                      </TableCell>
                      <TableCell className='text-right'>
                        <div className='flex items-center justify-end gap-2'>
                          {r.status === 'PENDING' && r.can_decide ? (
                            <>
                              <Button variant='success' size='sm' disabled={acting[r.id]} onClick={() => approve(r.id)}>
                                {acting[r.id] ? 'Memproses...' : 'Setujui'}
                              </Button>
                              <Button variant='destructive' size='sm' disabled={acting[r.id]} onClick={() => setRejecting(r)}>
                                Tolak
                              </Button>
                            </>
                          ) : r.status === 'PENDING' ? (
                            // Only the direct Reporting To (or HR) decides — e.g. a GM
                            // sees deeper levels of the hierarchy read-only.
                            <span className='text-muted-foreground text-xs'>
                              Menunggu {r.employee_manager_name || 'atasan langsung'}
                            </span>
                          ) : (
                            <span className='text-muted-foreground text-xs'>Selesai</span>
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

      <TeamQuotaCard
        title={isGm ? 'Sisa Kuota Cuti Karyawan' : 'Sisa Kuota Cuti Tim'}
        description={
          isGm
            ? 'Kuota per hari ini untuk seluruh karyawan aktif — cek sebelum menyetujui pengajuan.'
            : 'Kuota per hari ini untuk karyawan yang melapor langsung ke Anda — cek sebelum menyetujui pengajuan.'
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
