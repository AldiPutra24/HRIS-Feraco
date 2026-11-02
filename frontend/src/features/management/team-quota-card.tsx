'use client';

import { Fragment, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';
import { formatDays, getAllBalanceSummary, type EmployeeQuotaPage, type MyBalance } from '@/lib/leaves';

function initials(name: string): string {
  return name
    .replace(/\([^)]*\)/g, '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

/** Used (dark) · pending (orange) · free (green), scaled to quota + adjustment. */
export function UsageBar({ b }: { b: Pick<MyBalance, 'allocated_days' | 'adjustment_days' | 'used_days' | 'pending_days'> }) {
  const total = Math.max(0, b.allocated_days + b.adjustment_days, b.used_days + b.pending_days);
  if (total === 0) return <div className='bg-muted h-2 w-full rounded-full' />;
  const used = (b.used_days / total) * 100;
  const pending = (b.pending_days / total) * 100;
  const free = Math.max(0, 100 - used - pending);
  return (
    <div className='bg-muted flex h-2 w-full overflow-hidden rounded-full'>
      <div className='bg-foreground/70 h-full' style={{ width: `${used}%` }} />
      <div className='h-full bg-orange-500' style={{ width: `${pending}%` }} />
      <div className='bg-primary h-full' style={{ width: `${free}%` }} />
    </div>
  );
}

/**
 * "Sisa kuota cuti" for the Management / GM leave page. Rows are scoped by
 * the backend: GM = all active employees, MANAGEMENT = direct reports.
 */
export function TeamQuotaCard({ title, description, emptyText }: { title: string; description: string; emptyText: string }) {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
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
    let cancelled = false;
    setLoading(true);
    setError(null);
    getAllBalanceSummary(year, page, query)
      .then((d) => !cancelled && setData(d))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : 'Gagal memuat kuota.'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [year, page, query]);

  return (
    <Card className='gap-0 overflow-hidden py-0'>
      <div className='flex flex-wrap items-start justify-between gap-3 px-6 py-5'>
        <div>
          <h3 className='text-lg font-semibold'>{title}</h3>
          <p className='text-muted-foreground mt-0.5 text-sm'>{description}</p>
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          <div className='relative'>
            <Icons.search className='text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2' />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder='Cari nama karyawan…'
              aria-label='Cari nama karyawan'
              className='border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-10 w-64 rounded-lg border pr-3 pl-9 text-sm outline-none focus-visible:ring-3'
            />
          </div>
          <label className='bg-background flex h-10 items-center gap-2 rounded-lg border px-3 text-sm'>
            <span className='text-muted-foreground'>Tahun</span>
            <select
              aria-label='Pilih tahun'
              value={year}
              onChange={(e) => {
                setYear(Number(e.target.value));
                setPage(1);
              }}
              className='bg-transparent font-medium outline-none'
            >
              {[thisYear - 1, thisYear, thisYear + 1].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {loading && !data ? (
        <div className='border-t px-6 py-5'>
          <Skeleton className='h-48 w-full' />
        </div>
      ) : error ? (
        <p className='text-destructive border-t px-6 py-6 text-sm'>{error}</p>
      ) : !data || data.results.length === 0 ? (
        <p className='text-muted-foreground border-t px-6 py-10 text-center text-sm'>
          {query ? 'Tidak ada karyawan yang cocok.' : emptyText}
        </p>
      ) : (
        <div className={cn('overflow-x-auto border-t', loading && 'opacity-60')}>
          <table className='w-full text-sm'>
            <thead className='bg-muted/40 text-muted-foreground text-left'>
              <tr>
                <th className='px-6 py-3 font-medium'>Karyawan</th>
                <th className='px-4 py-3 font-medium'>Jenis</th>
                <th className='w-56 px-4 py-3 font-medium'>Pemakaian</th>
                <th className='px-4 py-3 text-right font-medium'>Kuota</th>
                <th className='px-4 py-3 text-right font-medium'>Adjustment</th>
                <th className='px-4 py-3 text-right font-medium'>Terpakai</th>
                <th className='px-4 py-3 text-right font-medium'>Pending</th>
                <th className='text-foreground px-6 py-3 text-right font-semibold'>Sisa</th>
              </tr>
            </thead>
            <tbody>
              {data.results.map((emp, ei) => (
                <Fragment key={emp.employee}>
                  {emp.rows.map((b, i) => {
                    const notEligible = b.leave_type_code === 'ANNUAL' && b.allocated_days === 0 && b.adjustment_days === 0;
                    return (
                      <tr
                        key={`${emp.employee}-${b.leave_type}`}
                        className={cn(i === 0 && 'border-t', ei % 2 === 1 && 'bg-muted/30')}
                      >
                        {i === 0 && (
                          <td rowSpan={emp.rows.length} className='px-6 py-4 align-top'>
                            <div className='flex items-center gap-3'>
                              <span className='bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold'>
                                {initials(emp.employee_name)}
                              </span>
                              <span className='font-medium'>{emp.employee_name}</span>
                            </div>
                          </td>
                        )}
                        <td className='px-4 py-4'>
                          {b.leave_type_name}
                          {notEligible && (
                            <p className='text-xs text-orange-700 dark:text-orange-300'>Belum berhak · masa kerja &lt; 3 bulan</p>
                          )}
                        </td>
                        <td className='px-4 py-4'>
                          <UsageBar b={b} />
                        </td>
                        <td className='px-4 py-4 text-right tabular-nums'>{formatDays(b.allocated_days)}</td>
                        <td className={cn('px-4 py-4 text-right tabular-nums', b.adjustment_days > 0 && 'text-primary')}>
                          {b.adjustment_days > 0 ? '+' : ''}
                          {formatDays(b.adjustment_days)}
                        </td>
                        <td className='px-4 py-4 text-right tabular-nums'>{formatDays(b.used_days)}</td>
                        <td
                          className={cn(
                            'px-4 py-4 text-right tabular-nums',
                            b.pending_days > 0 && 'font-medium text-orange-700 dark:text-orange-300'
                          )}
                        >
                          {formatDays(b.pending_days)}
                        </td>
                        <td className='px-6 py-4 text-right font-semibold tabular-nums'>{formatDays(b.remaining_days)}</td>
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && data.results.length > 0 && (
        <div className='text-muted-foreground flex flex-wrap items-center justify-between gap-3 border-t px-6 py-3.5 text-xs'>
          <div className='flex flex-wrap items-center gap-x-4 gap-y-1'>
            <span className='flex items-center gap-1.5'>
              <span className='bg-foreground/70 size-2 rounded-sm' />
              Terpakai
            </span>
            <span className='flex items-center gap-1.5'>
              <span className='size-2 rounded-sm bg-orange-500' />
              Pending
            </span>
            <span className='flex items-center gap-1.5'>
              <span className='bg-primary size-2 rounded-sm' />
              Sisa · Sisa = Kuota + Adjustment − Terpakai
            </span>
          </div>
          <div className='flex items-center gap-2'>
            <span>
              {data.count} karyawan · halaman {data.page} dari {data.total_pages}
            </span>
            {data.total_pages > 1 && (
              <>
                <Button
                  variant='outline'
                  size='icon-sm'
                  aria-label='Halaman sebelumnya'
                  disabled={loading || data.page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <Icons.chevronLeft className='size-4' />
                </Button>
                <Button
                  variant='outline'
                  size='icon-sm'
                  aria-label='Halaman berikutnya'
                  disabled={loading || data.page >= data.total_pages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <Icons.chevronRight className='size-4' />
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
