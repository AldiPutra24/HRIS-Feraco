'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cancelReimbursement, listReimbursements, type Reimbursement } from '@/lib/reimbursements';
import { toast } from 'react-toastify';

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  DRAFT: 'outline',
  PENDING: 'secondary',
  APPROVED: 'default',
  REJECTED: 'destructive',
  PAID: 'default',
  CANCELLED: 'outline'
};

function StatusBadge({ status }: { status: string }) {
  return <Badge variant={STATUS_VARIANT[status] ?? 'secondary'}>{status}</Badge>;
}

function formatAmount(n: number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(n);
}

export function EmployeeReimbursement() {
  const router = useRouter();
  const [items, setItems] = useState<Reimbursement[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await listReimbursements();
    setItems(r);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function cancel(r: Reimbursement) {
    if (!window.confirm('Batalkan pengajuan ini?')) return;
    try {
      await cancelReimbursement(r.id);
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

  const pending = items.filter((r) => r.status === 'PENDING').length;
  const total = items.reduce((sum, r) => sum + (r.status === 'PAID' ? r.amount : 0), 0);

  return (
    <div className='flex flex-1 flex-col gap-4 p-4 md:p-6'>
      <div className='flex items-center justify-between'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>Pengajuan Saya</h2>
          <p className='text-muted-foreground text-sm'>Riwayat pengajuan reimbursement Anda.</p>
        </div>
        <Button onClick={() => router.push('/dashboard/employee/reimbursement/new')}>Ajukan Reimbursement</Button>
      </div>

      <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
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
            <CardTitle className='text-sm'>Total Dibayar</CardTitle>
          </CardHeader>
          <CardContent>
            <p className='text-3xl font-semibold'>{formatAmount(total)}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Riwayat Pengajuan</CardTitle>
        </CardHeader>
        <CardContent className='p-0'>
          {items.length === 0 ? (
            <p className='text-muted-foreground p-6 text-center'>Belum ada pengajuan.</p>
          ) : (
            <div className='overflow-x-auto'>
              <table className='w-full text-sm'>
                <TableHeader>
                  <TableRow>
                    <TableHead>Kategori</TableHead>
                    <TableHead>Tanggal</TableHead>
                    <TableHead className='text-right'>Jumlah</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Lampiran</TableHead>
                    <TableHead className='text-right'>Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{r.category_name}</TableCell>
                      <TableCell>{r.transaction_date}</TableCell>
                      <TableCell className='text-right'>{formatAmount(r.amount)}</TableCell>
                      <TableCell>
                        <StatusBadge status={r.status} />
                      </TableCell>
                      <TableCell>
                        {r.attachment_url ? (
                          <a href={r.attachment_url} target='_blank' rel='noreferrer' className='text-primary underline'>
                            {r.attachment_name}
                          </a>
                        ) : (
                          <span className='text-muted-foreground'>-</span>
                        )}
                      </TableCell>
                      <TableCell className='text-right'>
                        {r.status === 'DRAFT' && (
                          <Button size='sm' variant='ghost' onClick={() => cancel(r)}>
                            Hapus
                          </Button>
                        )}
                        {r.status === 'PENDING' && (
                          <Button size='sm' variant='ghost' onClick={() => cancel(r)}>
                            Batalkan
                          </Button>
                        )}
                        {r.status === 'REJECTED' && r.rejection_reason && (
                          <span className='text-muted-foreground text-xs'>{r.rejection_reason}</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
