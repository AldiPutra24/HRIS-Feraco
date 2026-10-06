'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDays, getAllBalanceSummary, type EmployeeQuotaPage } from '@/lib/leaves';

/**
 * HR "Semua Karyawan" quota overview: every ACTIVE employee's quota for a
 * year (quota engine — no leave history needed), 10 employees per page.
 * Clicking a name opens that employee's detail view (with adjustments).
 */
export function AllQuotaTable({ year, onSelect }: { year: number; onSelect: (employeeId: number) => void }) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [data, setData] = useState<EmployeeQuotaPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Debounce the name search; a new search or year starts from page 1.
  useEffect(() => {
    const handle = window.setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(handle);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [year]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getAllBalanceSummary(year, page, query)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Gagal memuat kuota.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [year, page, query]);

  return (
    <div className='space-y-3'>
      <Input
        className='max-w-xs'
        placeholder='Cari nama karyawan...'
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label='Cari nama karyawan'
      />
      {loading && !data ? (
        <Skeleton className='h-48 w-full' />
      ) : error ? (
        <p className='text-destructive text-sm'>{error}</p>
      ) : !data || data.results.length === 0 ? (
        <p className='text-muted-foreground text-sm'>Tidak ada karyawan aktif.</p>
      ) : (
        <>
          <div className={`overflow-x-auto ${loading ? 'opacity-60' : ''}`}>
            <table className='w-full text-sm'>
              <TableHeader>
                <TableRow>
                  <TableHead>Karyawan</TableHead>
                  <TableHead>Jenis</TableHead>
                  <TableHead>Kuota</TableHead>
                  <TableHead>Adjustment</TableHead>
                  <TableHead>Terpakai</TableHead>
                  <TableHead>Pending</TableHead>
                  <TableHead>Sisa</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.results.flatMap((emp) =>
                  emp.rows.map((b, i) => (
                    <TableRow key={`${emp.employee}-${b.leave_type}`}>
                      {i === 0 && (
                        <TableCell rowSpan={emp.rows.length} className='align-top font-medium'>
                          <button
                            type='button'
                            className='text-primary text-left hover:underline'
                            onClick={() => onSelect(emp.employee)}
                          >
                            {emp.employee_name}
                          </button>
                        </TableCell>
                      )}
                      <TableCell>
                        {b.leave_type_name}
                        {b.leave_type_code === 'ANNUAL' && b.allocated_days === 0 && b.adjustment_days === 0 && (
                          <p className='text-muted-foreground text-xs'>belum berhak (masa kerja &lt; 3 bulan)</p>
                        )}
                      </TableCell>
                      <TableCell>{formatDays(b.allocated_days)}</TableCell>
                      <TableCell>
                        {b.adjustment_days > 0 ? '+' : ''}
                        {formatDays(b.adjustment_days)}
                      </TableCell>
                      <TableCell>{formatDays(b.used_days)}</TableCell>
                      <TableCell>{formatDays(b.pending_days)}</TableCell>
                      <TableCell className='font-medium'>{formatDays(b.remaining_days)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </table>
          </div>
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <p className='text-muted-foreground text-xs'>
              {data.count} karyawan · halaman {data.page} dari {data.total_pages}
            </p>
            <div className='flex gap-2'>
              <Button
                variant='outline'
                size='sm'
                disabled={loading || data.page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Sebelumnya
              </Button>
              <Button
                variant='outline'
                size='sm'
                disabled={loading || data.page >= data.total_pages}
                onClick={() => setPage((p) => p + 1)}
              >
                Berikutnya
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
