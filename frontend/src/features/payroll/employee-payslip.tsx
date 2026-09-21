'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Icons } from '@/components/icons';
import { downloadPayslip, listMyPayslips, type MyPayroll } from '@/lib/payroll';
import { toast } from 'react-toastify';

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  PAID: 'default',
  LOCKED: 'secondary'
};

function StatusBadge({ status, statusLabel }: { status: string; statusLabel: string }) {
  return <Badge variant={STATUS_VARIANT[status] ?? 'secondary'}>{statusLabel}</Badge>;
}

function formatAmount(n: number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(n);
}

export function EmployeePayslip() {
  const [items, setItems] = useState<MyPayroll[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setItems(await listMyPayslips());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat slip gaji.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function download(p: MyPayroll) {
    setDownloadingId(p.id);
    try {
      await downloadPayslip(p.id, `slip-gaji-${p.period_label}`);
      toast.success('Slip gaji diunduh.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal mengunduh slip gaji.');
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <div className='flex flex-1 flex-col gap-4 p-4 md:p-6'>
      <div>
        <h2 className='text-2xl font-bold tracking-tight'>Slip Gaji</h2>
        <p className='text-muted-foreground text-sm'>Daftar slip gaji Anda.</p>
      </div>

      {error && <p className='text-destructive text-sm'>{error}</p>}

      {loading ? (
        <div className='space-y-2'>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className='h-20 w-full' />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className='flex flex-col items-center gap-2 py-12 text-center'>
            <Icons.page className='text-muted-foreground h-10 w-10' />
            <p className='font-medium'>Belum ada slip gaji</p>
            <p className='text-muted-foreground text-sm'>
              Slip gaji tersedia setelah payroll periode dibayar (PAID/LOCKED).
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
          {items.map((p) => (
            <Card key={p.id}>
              <CardContent className='flex flex-col gap-3 p-4'>
                <div className='flex items-center justify-between'>
                  <span className='text-base font-semibold'>{p.period_label}</span>
                  <StatusBadge status={p.period_status} statusLabel={p.period_status === 'PAID' ? 'Dibayar' : 'Terkunci'} />
                </div>
                <div className='text-sm'>
                  <div className='flex justify-between'>
                    <span className='text-muted-foreground'>Take Home Pay</span>
                    <span className='font-medium'>{formatAmount(Number(p.net_salary))}</span>
                  </div>
                  {p.is_dtp && Number(p.transfer_amount) !== Number(p.net_salary) && (
                    <div className='mt-1 flex justify-between'>
                      <span className='text-muted-foreground'>Transfer</span>
                      <span className='font-medium'>{formatAmount(Number(p.transfer_amount))}</span>
                    </div>
                  )}
                </div>
                <Button
                  size='sm'
                  className='w-full'
                  disabled={downloadingId === p.id}
                  onClick={() => download(p)}
                >
                  <Icons.download />
                  {downloadingId === p.id ? 'Mengunduh…' : 'Download Slip'}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
