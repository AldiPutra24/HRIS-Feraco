'use client';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useMyEmployee } from './use-my-employee';

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  ACTIVE: 'default',
  EXPIRED: 'destructive',
  TERMINATED: 'destructive',
  RENEWED: 'secondary',
  DRAFT: 'outline'
};

export function EmployeeContractPage() {
  const { contracts, loading, error } = useMyEmployee();
  const current = contracts.find((c) => c.is_current) ?? null;

  if (error) {
    return (
      <div className='p-4 md:p-6'>
        <p className='text-destructive'>{error}</p>
      </div>
    );
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
        <h2 className='text-2xl font-bold tracking-tight'>Kontrak</h2>
        <p className='text-muted-foreground text-sm'>Informasi kontrak Anda.</p>
      </div>

      {current && (
        <Card>
          <CardHeader>
            <CardTitle>Kontrak Saat Ini</CardTitle>
          </CardHeader>
          <CardContent className='space-y-2'>
            <div className='flex justify-between'>
              <span className='text-muted-foreground text-sm'>Tipe</span>
              <span className='font-medium'>{current.contract_type}</span>
            </div>
            <div className='flex justify-between'>
              <span className='text-muted-foreground text-sm'>Periode</span>
              <span className='font-medium'>
                {current.start_date} — {current.end_date ?? 'Berlangsung'}
              </span>
            </div>
            <div className='flex justify-between'>
              <span className='text-muted-foreground text-sm'>Status</span>
              <Badge variant={STATUS_VARIANT[current.status] ?? 'secondary'}>{current.status}</Badge>
            </div>
            {current.end_date && (
              <div className='flex justify-between'>
                <span className='text-muted-foreground text-sm'>Berakhir</span>
                <span className='font-medium'>{current.end_date}</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {!current && (
        <Card>
          <CardContent className='text-muted-foreground p-6 text-center'>
            Tidak ada kontrak aktif.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
