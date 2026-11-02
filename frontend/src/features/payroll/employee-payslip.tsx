'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';
import { downloadPayslip, listMyPayslips, type MyPayroll } from '@/lib/payroll';

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const MONTHS_SHORT = ['JAN', 'FEB', 'MAR', 'APR', 'MEI', 'JUN', 'JUL', 'AGU', 'SEP', 'OKT', 'NOV', 'DES'];
const HIDE_KEY = 'payslip-hide-amount';

/** "Oktober 2026" (backend period_label) -> month index + year. */
function parsePeriod(label: string): { month: number; year: number } {
  const [name, year] = label.split(' ');
  return { month: MONTHS.indexOf(name), year: Number(year) || 0 };
}

function rupiah(value: string | number): string {
  return `Rp ${Math.round(Number(value) || 0).toLocaleString('id-ID')}`;
}

const STATUS: Record<string, string> = { PAID: 'Dibayar', LOCKED: 'Terkunci' };

function StatusChip({ status, final }: { status: string; final?: boolean }) {
  return (
    <span className='bg-muted text-muted-foreground inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap'>
      {status === 'PAID' ? <Icons.circleCheck className='size-3.5' /> : <Icons.lock className='size-3.5' />}
      {STATUS[status] ?? status}
      {final && status === 'LOCKED' ? ' · final' : ''}
    </span>
  );
}

/** Self-service payslips (Employee "Slip Gaji", Management "Slip Gaji"). */
export function EmployeePayslip() {
  const [items, setItems] = useState<MyPayroll[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [hidden, setHidden] = useState(false);

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
    try {
      setHidden(window.localStorage.getItem(HIDE_KEY) === '1');
    } catch {
      // Storage blocked: amounts stay visible.
    }
  }, [load]);

  function toggleHidden() {
    setHidden((h) => {
      try {
        window.localStorage.setItem(HIDE_KEY, h ? '0' : '1');
      } catch {
        // Preference lasts for this page view only.
      }
      return !h;
    });
  }

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

  // API order: newest period first.
  const years = [...new Set(items.map((p) => parsePeriod(p.period_label).year))].sort((a, b) => b - a);
  const activeYear = year ?? years[0] ?? new Date().getFullYear();
  const visible = items.filter((p) => parsePeriod(p.period_label).year === activeYear);
  const hero = visible[0] ?? null;
  const isLatest = hero !== null && hero.id === items[0]?.id;
  const amount = (v: string | number) => (hidden ? 'Rp ••••••••' : rupiah(v));

  return (
    <div className='flex flex-1 flex-col gap-6 p-4 md:p-8'>
      <div className='flex flex-wrap items-start justify-between gap-4'>
        <div>
          <h2 className='text-3xl font-bold tracking-tight'>Slip Gaji</h2>
          <p className='text-muted-foreground mt-1'>Lihat dan unduh slip gaji bulanan Anda.</p>
        </div>
        {items.length > 0 && (
          <div className='flex flex-wrap items-center gap-2'>
            <Button variant='outline' className='h-11 px-4' onClick={toggleHidden} aria-pressed={hidden}>
              {hidden ? <Icons.eye className='size-4' /> : <Icons.eyeOff className='size-4' />}
              {hidden ? 'Tampilkan nominal' : 'Sembunyikan nominal'}
            </Button>
            <label className='bg-card flex h-11 items-center gap-2 rounded-lg border px-3 text-sm'>
              <span className='text-muted-foreground'>Tahun</span>
              <select
                value={activeYear}
                onChange={(e) => setYear(Number(e.target.value))}
                className='bg-transparent font-medium outline-none'
              >
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </div>

      {error && <p className='text-destructive text-sm'>{error}</p>}

      {loading ? (
        <div className='space-y-3'>
          <Skeleton className='h-64 w-full' />
          <Skeleton className='h-40 w-full' />
        </div>
      ) : items.length === 0 ? (
        <Card className='items-center gap-2 px-6 py-14 text-center'>
          <span className='bg-muted mb-2 flex size-14 items-center justify-center rounded-2xl'>
            <Icons.page className='text-muted-foreground size-6' />
          </span>
          <p className='font-semibold'>Belum ada slip gaji</p>
          <p className='text-muted-foreground max-w-md text-sm'>
            Slip gaji tersedia setelah payroll periode tersebut dikunci atau dibayar oleh HR.
          </p>
        </Card>
      ) : (
        <>
          {hero && (
            <Card className='gap-0 overflow-hidden py-0'>
              <div className='flex flex-col gap-5 px-6 py-6'>
                <div className='flex flex-wrap items-start justify-between gap-3'>
                  <div>
                    <p className='text-primary font-mono text-xs tracking-widest uppercase'>
                      {isLatest ? 'Slip terbaru' : `Slip terakhir ${activeYear}`}
                    </p>
                    <h3 className='mt-1 text-2xl font-semibold'>{hero.period_label}</h3>
                  </div>
                  <StatusChip status={hero.period_status} final />
                </div>
                <div>
                  <p className='text-muted-foreground text-sm'>Take home pay</p>
                  <p className='mt-1 text-5xl font-bold tracking-tight tabular-nums'>{amount(hero.net_salary)}</p>
                  {hero.is_dtp && Number(hero.transfer_amount) !== Number(hero.net_salary) && (
                    <p className='text-muted-foreground mt-1 text-sm'>Ditransfer {amount(hero.transfer_amount)}</p>
                  )}
                </div>
                <Button size='lg' className='h-12 w-fit px-5' disabled={downloadingId === hero.id} onClick={() => download(hero)}>
                  {downloadingId === hero.id ? <Icons.spinner className='size-4 animate-spin' /> : <Icons.download className='size-4' />}
                  {downloadingId === hero.id ? 'Mengunduh…' : 'Unduh slip (PDF)'}
                </Button>
              </div>
              <p className='bg-muted/40 text-muted-foreground flex items-center gap-2.5 border-t px-6 py-3.5 text-sm'>
                <Icons.lock className='size-4 shrink-0' />
                Slip gaji bersifat rahasia. Jangan bagikan file atau tangkapan layar slip kepada pihak lain.
              </p>
            </Card>
          )}

          <Card className='gap-0 overflow-hidden py-0'>
            <div className='flex items-center justify-between gap-3 px-6 py-5'>
              <h3 className='text-lg font-semibold'>Semua slip</h3>
              <span className='bg-muted rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums'>
                {visible.length} slip
              </span>
            </div>
            {visible.length === 0 ? (
              <p className='text-muted-foreground border-t px-6 py-8 text-center text-sm'>Tidak ada slip di tahun {activeYear}.</p>
            ) : (
              <ul className='divide-y border-t'>
                {visible.map((p) => {
                  const { month, year: y } = parsePeriod(p.period_label);
                  return (
                    <li
                      key={p.id}
                      className={cn('flex flex-wrap items-center gap-4 px-6 py-4', p.id === hero?.id && 'bg-muted/30')}
                    >
                      <span className='bg-muted flex size-14 shrink-0 flex-col items-center justify-center rounded-xl leading-tight'>
                        <span className='text-muted-foreground text-[11px] font-medium'>{MONTHS_SHORT[month] ?? '—'}</span>
                        <span className='text-base font-semibold tabular-nums'>{String(y).slice(-2)}</span>
                      </span>
                      <div className='min-w-0 flex-1'>
                        <p className='font-semibold'>{p.period_label}</p>
                        <p className='text-muted-foreground text-sm'>
                          Take home pay · <span className='text-foreground font-medium tabular-nums'>{amount(p.net_salary)}</span>
                        </p>
                      </div>
                      <StatusChip status={p.period_status} />
                      <Button variant='outline' className='h-11' disabled={downloadingId === p.id} onClick={() => download(p)}>
                        {downloadingId === p.id ? (
                          <Icons.spinner className='size-4 animate-spin' />
                        ) : (
                          <Icons.download className='size-4' />
                        )}
                        Unduh
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
