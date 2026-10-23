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
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Icons } from '@/components/icons';
import { ListPagination } from '@/components/list-pagination';
import { cn } from '@/lib/utils';
import {
  CHANGE_STATUS_VARIANT,
  approveChangeRequest,
  listChangeRequests,
  rejectChangeRequest,
  type ChangeRequest
} from '@/lib/profile-changes';

const PAGE_SIZE = 20;
const STATUS_TABS = [
  { value: 'PENDING', label: 'Menunggu' },
  { value: 'APPROVED', label: 'Disetujui' },
  { value: 'REJECTED', label: 'Ditolak' },
  { value: '', label: 'Semua' }
];
const LINK_CLASS = 'text-primary inline-flex items-center gap-1 text-xs font-medium hover:underline';

function fmtDate(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * /dashboard/perubahan-data — HR Staff / HR Lead / Admin review employee
 * data change requests (old → new + supporting document). Approving applies
 * the values; the backend enforces roles, re-validates and blocks self-review.
 */
export function ChangeRequestReview() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Default tab = PENDING; 'ALL' = no status filter.
  const statusParam = searchParams.get('status') ?? 'PENDING';
  const status = statusParam === 'ALL' ? '' : statusParam;
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  // Deep link from the notification bell: ?id=<id>
  const focusId = Number(searchParams.get('id')) || null;

  const [items, setItems] = useState<ChangeRequest[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<number | null>(null);
  const [rejecting, setRejecting] = useState<ChangeRequest | null>(null);
  const [reason, setReason] = useState('');

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams);
    if (value) params.set(key, value);
    else params.delete(key);
    if (key !== 'page') params.delete('page');
    router.replace(`/dashboard/perubahan-data${params.size ? `?${params}` : ''}`);
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { page: String(page) };
      if (status) params.status = status;
      const data = await listChangeRequests(params);
      setItems(data.results);
      setCount(data.count);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal memuat pengajuan.');
    } finally {
      setLoading(false);
    }
  }, [status, page]);

  useEffect(() => {
    load();
  }, [load]);

  async function approve(cr: ChangeRequest) {
    const fields = cr.items.map((it) => it.label).join(', ');
    if (!window.confirm(`Setujui perubahan data ${cr.employee_name} (${fields})? Data karyawan langsung diperbarui.`)) return;
    setActing(cr.id);
    try {
      await approveChangeRequest(cr.id);
      toast.success('Perubahan data disetujui dan diterapkan.');
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyetujui.');
    } finally {
      setActing(null);
    }
  }

  async function confirmReject() {
    if (!rejecting) return;
    if (!reason.trim()) {
      toast.error('Alasan penolakan wajib diisi.');
      return;
    }
    setActing(rejecting.id);
    try {
      await rejectChangeRequest(rejecting.id, reason.trim());
      toast.success('Pengajuan ditolak.');
      setRejecting(null);
      setReason('');
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menolak.');
    } finally {
      setActing(null);
    }
  }

  return (
    <div className='flex flex-1 flex-col gap-4 p-4 md:p-6'>
      <div>
        <h2 className='text-2xl font-bold tracking-tight'>Perubahan Data Karyawan</h2>
        <p className='text-muted-foreground text-sm'>
          Tinjau pengajuan perubahan data pribadi (identitas, rekening, pajak/BPJS, status) dari karyawan.
        </p>
      </div>

      <div className='flex flex-wrap gap-2'>
        {STATUS_TABS.map((t) => (
          <Button
            key={t.value || 'all'}
            size='sm'
            variant={statusParam === (t.value || 'ALL') ? 'default' : 'outline'}
            onClick={() => setParam('status', t.value || 'ALL')}
          >
            {t.label}
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Daftar Pengajuan</CardTitle>
        </CardHeader>
        <CardContent className='p-0'>
          {loading ? (
            <div className='space-y-2 p-4'>
              <Skeleton className='h-10 w-full' />
              <Skeleton className='h-10 w-full' />
            </div>
          ) : items.length === 0 ? (
            <p className='text-muted-foreground p-6 text-center'>Tidak ada pengajuan.</p>
          ) : (
            <div className='overflow-x-auto'>
              <table className='w-full min-w-[960px] text-sm'>
                <TableHeader>
                  <TableRow>
                    <TableHead>Karyawan</TableHead>
                    <TableHead>Perubahan</TableHead>
                    <TableHead>Catatan</TableHead>
                    <TableHead>Dokumen</TableHead>
                    <TableHead>Diajukan</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className='text-right'>Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((cr) => (
                    <TableRow key={cr.id} className={cn(cr.id === focusId && 'bg-primary/5')}>
                      <TableCell>
                        <p className='font-medium'>{cr.employee_name}</p>
                        <p className='text-muted-foreground text-xs'>{cr.employee_code}</p>
                      </TableCell>
                      <TableCell className='min-w-64'>
                        <div className='space-y-1'>
                          {cr.items.map((it) => (
                            <p key={it.field} className='text-xs break-words'>
                              <span className='text-muted-foreground'>{it.label}:</span>{' '}
                              <span className='line-through decoration-muted-foreground/60'>{it.old || '-'}</span> →{' '}
                              <span className='font-semibold'>{it.new || '-'}</span>
                            </p>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className='max-w-56 text-xs whitespace-normal break-words'>{cr.note || '-'}</TableCell>
                      <TableCell>
                        {cr.attachment_url ? (
                          <a href={cr.attachment_url} target='_blank' rel='noreferrer' title={cr.attachment_name} className={LINK_CLASS}>
                            <Icons.paperclip className='size-3.5' />
                            Lampiran
                          </a>
                        ) : (
                          <span className='text-muted-foreground text-xs'>-</span>
                        )}
                      </TableCell>
                      <TableCell className='text-xs'>{fmtDate(cr.created_at)}</TableCell>
                      <TableCell>
                        <Badge variant={CHANGE_STATUS_VARIANT[cr.status]}>{cr.status_display}</Badge>
                        {cr.reviewed_by_name && (
                          <p className='text-muted-foreground mt-1 text-xs'>
                            oleh {cr.reviewed_by_name} · {fmtDate(cr.reviewed_at)}
                          </p>
                        )}
                        {cr.status === 'REJECTED' && cr.rejection_reason && (
                          <p className='text-destructive mt-1 text-xs'>{cr.rejection_reason}</p>
                        )}
                      </TableCell>
                      <TableCell className='text-right'>
                        {cr.status === 'PENDING' ? (
                          <div className='flex justify-end gap-1'>
                            <Button variant='success' size='sm' disabled={acting === cr.id} onClick={() => approve(cr)}>
                              Setujui
                            </Button>
                            <Button variant='outline' size='sm' disabled={acting === cr.id} onClick={() => setRejecting(cr)}>
                              Tolak
                            </Button>
                          </div>
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
          <ListPagination
            page={page}
            pageSize={PAGE_SIZE}
            count={count}
            loading={loading}
            onPage={(p) => setParam('page', p > 1 ? String(p) : '')}
          />
        </CardContent>
      </Card>

      {rejecting && (
        <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4'>
          <Card className='w-full max-w-md'>
            <CardHeader>
              <CardTitle>Tolak Perubahan Data</CardTitle>
            </CardHeader>
            <CardContent className='space-y-3'>
              <p className='text-muted-foreground text-sm'>
                {rejecting.employee_name} — {rejecting.items.map((it) => it.label).join(', ')}
              </p>
              <Label className='text-xs'>Alasan Penolakan</Label>
              <Input placeholder='Mis. foto KTP tidak terbaca' value={reason} onChange={(e) => setReason(e.target.value)} />
              <div className='flex justify-end gap-2'>
                <Button variant='ghost' onClick={() => setRejecting(null)}>
                  Batal
                </Button>
                <Button variant='destructive' disabled={acting === rejecting.id} onClick={confirmReject}>
                  Tolak
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
