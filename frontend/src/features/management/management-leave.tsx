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
import {
  approveLeave,
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
                        {r.start_date} — {r.end_date}
                      </TableCell>
                      <TableCell>{r.total_days}</TableCell>
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
                          {r.status === 'PENDING' ? (
                            <>
                              <Button variant='success' size='sm' disabled={acting[r.id]} onClick={() => approve(r.id)}>
                                {acting[r.id] ? 'Memproses...' : 'Setujui'}
                              </Button>
                              <Button variant='destructive' size='sm' disabled={acting[r.id]} onClick={() => setRejecting(r)}>
                                Tolak
                              </Button>
                            </>
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

      {rejecting && (
        <Card>
          <CardHeader>
            <CardTitle>Tolak Pengajuan — {rejecting.employee_name}</CardTitle>
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
    </div>
  );
}
