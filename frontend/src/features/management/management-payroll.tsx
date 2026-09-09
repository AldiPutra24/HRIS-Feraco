'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { listPeriods, listPayrolls, type Payroll, type PayrollPeriod } from '@/lib/payroll';
import { useAuth } from '@/lib/auth/auth-provider';

const MONTHS = [
  { value: 1, label: 'Januari' },
  { value: 2, label: 'Februari' },
  { value: 3, label: 'Maret' },
  { value: 4, label: 'April' },
  { value: 5, label: 'Mei' },
  { value: 6, label: 'Juni' },
  { value: 7, label: 'Juli' },
  { value: 8, label: 'Agustus' },
  { value: 9, label: 'September' },
  { value: 10, label: 'Oktober' },
  { value: 11, label: 'November' },
  { value: 12, label: 'Desember' }
];

function badgeColor(status: string): 'default' | 'secondary' | 'outline' | 'destructive' {
  switch (status) {
    case 'PAID':
    case 'APPROVED':
      return 'default';
    case 'LOCKED':
      return 'secondary';
    case 'DRAFT':
      return 'outline';
    default:
      return 'secondary';
  }
}

/**
 * Management Payroll — self-service view of the logged-in Management's own
 * payroll slips. Backend scopes GET /api/payroll/payrolls/ to the requester's
 * own employee record for the MANAGEMENT role, so no data filtering here.
 */
export function ManagementPayroll() {
  const { user } = useAuth();
  const [periods, setPeriods] = useState<PayrollPeriod[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<PayrollPeriod | null>(null);
  const [payrolls, setPayrolls] = useState<Payroll[]>([]);
  const [loading, setLoading] = useState(true);
  const [slipLoading, setSlipLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setPeriods(await listPeriods());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat periode payroll.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!selectedPeriod) {
      setPayrolls([]);
      return;
    }
    let active = true;
    setSlipLoading(true);
    listPayrolls(selectedPeriod.id)
      .then((p) => {
        if (active) setPayrolls(p);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Gagal memuat slip gaji.');
      })
      .finally(() => {
        if (active) setSlipLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedPeriod]);

  const periodLabel = (p: PayrollPeriod) =>
    `${MONTHS.find((m) => m.value === p.period_month)?.label ?? p.period_month} ${p.period_year}`;

  return (
    <div className='flex flex-1 flex-col gap-4 p-4 md:p-6'>
      <div>
        <h2 className='text-2xl font-bold tracking-tight'>Payroll</h2>
        <p className='text-muted-foreground text-sm'>Slip gaji Anda. Data payroll karyawan lain tidak dapat diakses.</p>
      </div>

      {error && <p className='text-destructive text-sm'>{error}</p>}

      {loading ? (
        <div className='space-y-2'>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className='h-12 w-full' />
          ))}
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Periode Payroll</CardTitle>
          </CardHeader>
          <CardContent className='p-0'>
            {periods.length === 0 ? (
              <p className='text-muted-foreground p-6 text-center'>Belum ada periode payroll.</p>
            ) : (
              <div className='flex flex-wrap gap-2 p-4'>
                {periods.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setSelectedPeriod(selectedPeriod?.id === p.id ? null : p)}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                      selectedPeriod?.id === p.id
                        ? 'border-primary bg-primary/5 font-medium'
                        : 'hover:bg-muted'
                    }`}
                  >
                    {periodLabel(p)}
                    <Badge variant={badgeColor(p.status)}>{p.status_display}</Badge>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {selectedPeriod && (
        <Card>
          <CardHeader>
            <CardTitle>
              Slip Gaji — {periodLabel(selectedPeriod)}
            </CardTitle>
          </CardHeader>
          <CardContent className='p-0'>
            {slipLoading ? (
              <div className='space-y-2 p-4'>
                <Skeleton className='h-8 w-full' />
              </div>
            ) : payrolls.length === 0 ? (
              <p className='text-muted-foreground p-6 text-center'>
                Belum ada slip gaji untuk periode ini.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Karyawan</TableHead>
                    <TableHead className='text-right'>Gaji Pokok</TableHead>
                    <TableHead className='text-right'>Tunj. Tetap</TableHead>
                    <TableHead className='text-right'>Tunj. Variabel</TableHead>
                    <TableHead className='text-right'>Potongan</TableHead>
                    <TableHead className='text-right'>Reimburs</TableHead>
                    <TableHead className='text-right'>Gross</TableHead>
                    <TableHead className='text-right'>Net</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payrolls.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className='font-medium'>{p.employee_name}</TableCell>
                      <TableCell className='text-right'>{Number(p.basic_salary).toLocaleString('id')}</TableCell>
                      <TableCell className='text-right'>{Number(p.total_fixed_earning).toLocaleString('id')}</TableCell>
                      <TableCell className='text-right'>{Number(p.total_variable_earning).toLocaleString('id')}</TableCell>
                      <TableCell className='text-right'>{Number(p.total_deduction).toLocaleString('id')}</TableCell>
                      <TableCell className='text-right'>{Number(p.reimbursement_total).toLocaleString('id')}</TableCell>
                      <TableCell className='text-right font-medium'>{Number(p.gross_salary).toLocaleString('id')}</TableCell>
                      <TableCell className='text-right font-medium text-green-600'>{Number(p.net_salary).toLocaleString('id')}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {!selectedPeriod && !loading && periods.length > 0 && (
        <p className='text-muted-foreground text-sm'>Pilih periode untuk melihat slip gaji Anda.</p>
      )}

      {user?.role !== 'management' && (
        <p className='text-muted-foreground text-xs'>
          Halaman ini ditujukan untuk peran Management.
        </p>
      )}
    </div>
  );
}
