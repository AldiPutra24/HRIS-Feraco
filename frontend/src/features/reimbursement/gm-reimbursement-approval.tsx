'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { toast } from 'react-toastify';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LinkifiedText } from '@/components/linkified-text';
import { AttachmentCell } from './attachment-cell';
import { ListPagination } from '@/components/list-pagination';
import { cn } from '@/lib/utils';
import {
  approveReimbursement,
  listGmApprovalReimbursements,
  listReimbursements,
  REIMBURSEMENT_PAGE_SIZE,
  reimbursementStatusLabel,
  rejectReimbursement,
  type Reimbursement
} from '@/lib/reimbursements';

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  PENDING: 'secondary',
  WAITING_HR_LEAD: 'secondary',
  APPROVED: 'default',
  REJECTED: 'destructive',
  PAID: 'default'
};

function formatAmount(n: number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(n);
}

/**
 * /dashboard/management/reimbursement/approval — General Manager gives the
 * final approval of HR Lead reimbursements (after HR Staff set the amount).
 * Scope and every permission are enforced by the backend (`approval=1`).
 */
export function GmReimbursementApproval() {
  const searchParams = useSearchParams();
  // Deep link from the notification bell: ?id=<id>
  const focusId = Number(searchParams.get('id')) || null;
  const [items, setItems] = useState<Reimbursement[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [waiting, setWaiting] = useState(0);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<number | null>(null);
  const [rejecting, setRejecting] = useState<Reimbursement | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [data, waitingPage] = await Promise.all([
        listGmApprovalReimbursements(page),
        // Total waiting for the GM across all pages (count only).
        listReimbursements({ approval: '1', status: 'WAITING_HR_LEAD', page_size: '1' })
      ]);
      setItems(data.results);
      setCount(data.count);
      setWaiting(waitingPage.count);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal memuat pengajuan.');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  async function approve(r: Reimbursement) {
    const amount = r.approved_amount != null ? formatAmount(r.approved_amount) : '-';
    if (!window.confirm(`Setujui pembayaran reimbursement ${r.employee_name} sebesar ${amount}?`)) return;
    setActing(r.id);
    try {
      await approveReimbursement(r.id);
      toast.success('Pembayaran reimbursement disetujui.');
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyetujui.');
    } finally {
      setActing(null);
    }
  }

  async function confirmReject() {
    if (!rejecting) return;
    if (!rejectReason.trim()) {
      toast.error('Alasan penolakan wajib diisi.');
      return;
    }
    setActing(rejecting.id);
    try {
      await rejectReimbursement(rejecting.id, rejectReason.trim());
      toast.success('Reimbursement ditolak.');
      setRejecting(null);
      setRejectReason('');
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menolak.');
    } finally {
      setActing(null);
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
        <h2 className='text-2xl font-bold tracking-tight'>Persetujuan Reimbursement HR Lead</h2>
        <p className='text-muted-foreground text-sm'>
          Approval final pengajuan reimbursement HR Lead, setelah nominal direview HR Staff.
        </p>
      </div>

      <Card className='gap-0 py-4'>
        <CardContent className='px-4'>
          <p className='text-muted-foreground text-xs font-medium'>Menunggu Approval Anda</p>
          <p className='mt-1 text-2xl font-semibold tabular-nums'>{waiting}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Daftar Pengajuan</CardTitle>
        </CardHeader>
        <CardContent className='p-0'>
          {items.length === 0 ? (
            <p className='text-muted-foreground p-6 text-center'>Belum ada pengajuan dari HR Lead.</p>
          ) : (
            <div className='overflow-x-auto'>
              <table className='w-full min-w-[960px] text-sm'>
                <TableHeader>
                  <TableRow>
                    <TableHead>HR Lead</TableHead>
                    <TableHead>Kategori</TableHead>
                    <TableHead>Deskripsi</TableHead>
                    <TableHead>Tanggal</TableHead>
                    <TableHead className='text-right'>Nominal Diajukan</TableHead>
                    <TableHead className='text-right'>Nominal Disetujui</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Bukti Payment/Invoice</TableHead>
                    <TableHead className='text-right'>Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((r) => (
                    <TableRow key={r.id} className={cn(r.id === focusId && 'bg-primary/5')}>
                      <TableCell>{r.employee_name}</TableCell>
                      <TableCell>{r.category_name}</TableCell>
                      <TableCell className='max-w-64 min-w-40 whitespace-normal break-words text-xs' title={r.description || undefined}>
                        {r.description ? (
                          <LinkifiedText text={r.description} className='line-clamp-3' />
                        ) : (
                          <span className='text-muted-foreground'>-</span>
                        )}
                      </TableCell>
                      <TableCell>{r.transaction_date}</TableCell>
                      <TableCell className='text-right'>{formatAmount(r.amount)}</TableCell>
                      <TableCell className='text-right'>
                        {r.approved_amount != null ? formatAmount(r.approved_amount) : '-'}
                        {r.amount_set_by_name && (
                          <span className='text-muted-foreground block text-xs'>oleh {r.amount_set_by_name}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[r.status] ?? 'secondary'}>{reimbursementStatusLabel(r)}</Badge>
                      </TableCell>
                      <TableCell>
                        <AttachmentCell r={r} />
                      </TableCell>
                      <TableCell className='text-right'>
                        {r.can_final_approve ? (
                          <div className='flex justify-end gap-1'>
                            <Button variant='success' size='sm' disabled={acting === r.id} onClick={() => approve(r)}>
                              Setujui Pembayaran
                            </Button>
                            <Button variant='destructive' size='sm' disabled={acting === r.id} onClick={() => setRejecting(r)}>
                              Tolak
                            </Button>
                          </div>
                        ) : r.status === 'PENDING' ? (
                          <span className='text-muted-foreground text-xs'>Menunggu review HR Staff</span>
                        ) : r.status === 'REJECTED' && r.rejection_reason ? (
                          <span className='text-muted-foreground text-xs'>{r.rejection_reason}</span>
                        ) : (
                          <span className='text-muted-foreground text-xs'>-</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </table>
            </div>
          )}
          <ListPagination page={page} pageSize={REIMBURSEMENT_PAGE_SIZE} count={count} loading={loading} onPage={setPage} />
        </CardContent>
      </Card>

      {rejecting && (
        <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4'>
          <Card className='w-full max-w-md'>
            <CardHeader>
              <CardTitle>Tolak Reimbursement</CardTitle>
            </CardHeader>
            <CardContent>
              <div className='space-y-3'>
                <p className='text-muted-foreground text-sm'>
                  {rejecting.employee_name} — {rejecting.category_name} ({formatAmount(rejecting.amount)})
                </p>
                <Label className='text-xs'>Alasan Penolakan</Label>
                <Input
                  placeholder='Alasan wajib diisi'
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                />
                <div className='flex justify-end gap-2'>
                  <Button variant='ghost' onClick={() => setRejecting(null)}>
                    Batal
                  </Button>
                  <Button variant='destructive' disabled={acting === rejecting.id} onClick={confirmReject}>
                    Tolak
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
