'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { toast } from 'react-toastify';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Icons } from '@/components/icons';
import { LinkifiedText } from '@/components/linkified-text';
import { cn } from '@/lib/utils';
import { listDepartments, type Department } from '@/lib/employees';
import {
  exportReimbursementsXlsx,
  getReimbursement,
  getReimbursementSummary,
  listReimbursementCategories,
  listReimbursements,
  recapReimbursement,
  REIMBURSEMENT_PAGE_SIZE,
  reimbursementProjectLabel,
  unrecapReimbursement,
  type Reimbursement,
  type ReimbursementCategory
} from '@/lib/reimbursements';
import { AttachmentCell } from './attachment-cell';

type RecapFilter = 'false' | 'true' | '';

const RECAP_FILTERS: { value: RecapFilter; label: string }[] = [
  { value: 'false', label: 'Belum direkap' },
  { value: 'true', label: 'Sudah direkap' },
  { value: '', label: 'Semua' }
];

function rupiah(n: number | string | null | undefined): string {
  return `Rp ${Math.round(Number(n) || 0).toLocaleString('id-ID')}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

const selectClass = 'border-input bg-background h-10 w-full rounded-lg border px-2.5 text-sm';

/**
 * Finance "Rekap Reimbursement": PAID reimbursements (read-only) with a
 * per-item "sudah direkap" mark. Access follows the employee's position flag
 * (backend `scope=recap`); HR keeps the full workflow on /dashboard/reimbursements.
 */
export function FinanceRecapPage() {
  const searchParams = useSearchParams();
  const focusId = Number(searchParams.get('id')) || null;

  const [recapped, setRecapped] = useState<RecapFilter>(focusId ? '' : 'false');
  const [department, setDepartment] = useState('');
  const [category, setCategory] = useState('');
  const [paidMonth, setPaidMonth] = useState('');
  const [page, setPage] = useState(1);

  const [items, setItems] = useState<Reimbursement[]>([]);
  const [count, setCount] = useState(0);
  const [focused, setFocused] = useState<Reimbursement | null>(null);
  const [totals, setTotals] = useState<{ pending: { n: number; amount: number }; done: { n: number; amount: number } } | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [categories, setCategories] = useState<ReimbursementCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    listDepartments().then((d) => setDepartments([...d].sort((a, b) => a.name.localeCompare(b.name)))).catch(() => {});
    listReimbursementCategories().then(setCategories).catch(() => {});
  }, []);

  /** Filters shared by list, KPI and export (recap mark excluded). */
  const baseFilters = useCallback(() => {
    const f: Record<string, string> = { scope: 'recap' };
    if (department) f.department = department;
    if (category) f.category = category;
    if (paidMonth) f.paid_month = paidMonth;
    return f;
  }, [department, category, paidMonth]);

  const load = useCallback(async () => {
    setLoading(true);
    const base = baseFilters();
    try {
      const [list, notYet, done] = await Promise.all([
        listReimbursements({ ...base, ...(recapped ? { recapped } : {}), page: String(page) }),
        getReimbursementSummary(false, { ...base, recapped: 'false' }),
        getReimbursementSummary(false, { ...base, recapped: 'true' })
      ]);
      setItems(list.results);
      setCount(list.count);
      setTotals({
        pending: { n: notYet.total, amount: Number(notYet.paid_amount) },
        done: { n: done.total, amount: Number(done.paid_amount) }
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal memuat data rekap.');
    } finally {
      setLoading(false);
    }
  }, [baseFilters, recapped, page]);

  useEffect(() => {
    load();
  }, [load]);

  // Deep link from the bell notification (?id=).
  useEffect(() => {
    if (!focusId) return;
    getReimbursement(focusId)
      .then((r) => setFocused(r.status === 'PAID' ? r : null))
      .catch(() => setFocused(null));
  }, [focusId]);

  function changeFilter(fn: () => void) {
    fn();
    setPage(1);
  }

  async function toggle(r: Reimbursement) {
    setBusyId(r.id);
    try {
      const updated = r.recapped_at ? await unrecapReimbursement(r.id) : await recapReimbursement(r.id);
      toast.success(updated.recapped_at ? 'Ditandai sudah direkap.' : 'Tanda rekap dibatalkan.');
      if (focused?.id === r.id) setFocused(updated);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal memperbarui tanda rekap.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      await exportReimbursementsXlsx({ ...baseFilters(), ...(recapped ? { recapped } : {}) });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal export XLSX.');
    } finally {
      setExporting(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(count / REIMBURSEMENT_PAGE_SIZE));

  const recapButton = (r: Reimbursement) =>
    r.recapped_at ? (
      <div className='flex flex-col items-end gap-1'>
        <span className='inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300'>
          <Icons.check className='size-3.5' />
          Direkap
        </span>
        <span className='text-muted-foreground text-[11px]'>
          {fmtDate(r.recapped_at)}
          {r.recapped_by_name ? ` · ${r.recapped_by_name}` : ''}
        </span>
        <button
          type='button'
          disabled={busyId === r.id}
          onClick={() => toggle(r)}
          className='text-muted-foreground hover:text-foreground text-[11px] underline disabled:opacity-50'
        >
          Batalkan
        </button>
      </div>
    ) : (
      <Button size='sm' disabled={busyId === r.id} onClick={() => toggle(r)}>
        {busyId === r.id ? <Icons.spinner className='size-4 animate-spin' /> : <Icons.check className='size-4' />}
        Tandai direkap
      </Button>
    );

  return (
    <div className='flex flex-1 flex-col gap-6 p-4 md:p-8'>
      <div>
        <h2 className='text-3xl font-bold tracking-tight'>Rekap Reimbursement</h2>
        <p className='text-muted-foreground mt-1'>
          Reimbursement yang sudah dibayar HR. Tandai setiap item setelah masuk rekap pengeluaran.
        </p>
      </div>

      <div className='grid gap-4 md:grid-cols-2'>
        {[
          { label: 'Belum direkap', data: totals?.pending, tone: 'text-orange-700 dark:text-orange-300', icon: 'clock' as const },
          { label: 'Sudah direkap', data: totals?.done, tone: 'text-primary', icon: 'circleCheck' as const }
        ].map((c) => {
          const Icon = Icons[c.icon];
          return (
            <Card key={c.label} className='gap-2 px-6 py-5'>
              <div className='text-muted-foreground flex items-center justify-between text-sm'>
                <span>{c.label}</span>
                <Icon className='size-5' />
              </div>
              {c.data ? (
                <>
                  <p className={cn('text-3xl font-semibold tabular-nums', c.tone)}>{c.data.n}</p>
                  <p className='text-muted-foreground text-sm'>Senilai {rupiah(c.data.amount)}</p>
                </>
              ) : (
                <Skeleton className='h-14 w-full' />
              )}
            </Card>
          );
        })}
      </div>

      {focused && (
        <Card className='border-primary/40 flex-row flex-wrap items-center gap-4 px-6 py-4'>
          <Icons.notification className='text-primary size-5 shrink-0' />
          <div className='min-w-0 flex-1'>
            <p className='font-semibold'>
              {focused.employee_name} · {focused.category_name} · {rupiah(focused.approved_amount ?? focused.amount)}
            </p>
            <p className='text-muted-foreground text-sm'>
              Dibayar {fmtDate(focused.paid_at)}
              {focused.payment_reference ? ` · ref ${focused.payment_reference}` : ''} · dari notifikasi
            </p>
          </div>
          {recapButton(focused)}
        </Card>
      )}

      <Card className='gap-0 overflow-hidden py-0'>
        <div className='flex flex-wrap items-end gap-3 px-6 py-5'>
          <div className='bg-muted flex rounded-lg p-1' role='group' aria-label='Status rekap'>
            {RECAP_FILTERS.map((f) => (
              <button
                key={f.label}
                type='button'
                aria-pressed={recapped === f.value}
                onClick={() => changeFilter(() => setRecapped(f.value))}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm transition-colors',
                  recapped === f.value ? 'bg-background font-semibold shadow-sm' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <label className='min-w-44 flex-1 space-y-1 text-xs'>
            <span className='text-muted-foreground'>Departemen</span>
            <select className={selectClass} value={department} onChange={(e) => changeFilter(() => setDepartment(e.target.value))}>
              <option value=''>Semua departemen</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </label>
          <label className='min-w-44 flex-1 space-y-1 text-xs'>
            <span className='text-muted-foreground'>Kategori</span>
            <select className={selectClass} value={category} onChange={(e) => changeFilter(() => setCategory(e.target.value))}>
              <option value=''>Semua kategori</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label className='min-w-40 space-y-1 text-xs'>
            <span className='text-muted-foreground'>Bulan dibayar</span>
            <input
              type='month'
              className={selectClass}
              value={paidMonth}
              onChange={(e) => changeFilter(() => setPaidMonth(e.target.value))}
            />
          </label>
          <Button variant='outline' className='h-10' onClick={handleExport} disabled={exporting}>
            <Icons.download className='size-4' />
            {exporting ? 'Mengekspor…' : 'Export XLSX'}
          </Button>
        </div>

        <div className='overflow-x-auto border-t'>
          <table className='w-full text-sm'>
            <thead className='bg-muted/40 text-muted-foreground text-left'>
              <tr>
                <th className='px-6 py-3 font-medium'>Karyawan</th>
                <th className='px-4 py-3 font-medium'>Kategori &amp; Deskripsi</th>
                <th className='px-4 py-3 font-medium'>Tgl Transaksi</th>
                <th className='px-4 py-3 text-right font-medium'>Nominal</th>
                <th className='px-4 py-3 font-medium'>Dibayar</th>
                <th className='px-4 py-3 font-medium'>Bukti</th>
                <th className='px-6 py-3 text-right font-medium'>Rekap</th>
              </tr>
            </thead>
            <tbody className={cn('divide-y', loading && 'opacity-60')}>
              {items.map((r) => (
                <tr key={r.id} className={cn('align-top', r.id === focusId && 'bg-primary/5')}>
                  <td className='px-6 py-4'>
                    <p className='font-medium'>{r.employee_name}</p>
                    <p className='text-muted-foreground text-xs'>{r.department_name || '—'}</p>
                  </td>
                  <td className='px-4 py-4'>
                    <p className='font-medium'>{r.category_name}</p>
                    <p className='text-muted-foreground text-xs'>{reimbursementProjectLabel(r)}</p>
                    {r.description && (
                      <LinkifiedText text={r.description} className='text-muted-foreground line-clamp-2 max-w-sm text-xs break-words' />
                    )}
                  </td>
                  <td className='px-4 py-4 whitespace-nowrap'>{fmtDate(r.transaction_date)}</td>
                  <td className='px-4 py-4 text-right font-semibold whitespace-nowrap tabular-nums'>
                    {rupiah(r.approved_amount ?? r.amount)}
                  </td>
                  <td className='px-4 py-4 whitespace-nowrap'>
                    <p>{fmtDate(r.paid_at)}</p>
                    {r.payment_reference && <p className='text-muted-foreground text-xs'>ref {r.payment_reference}</p>}
                  </td>
                  <td className='px-4 py-4'>
                    <div className='flex flex-col gap-1'>
                      <AttachmentCell r={r} />
                      {r.payment_proof_url && (
                        <a
                          href={r.payment_proof_url}
                          target='_blank'
                          rel='noreferrer'
                          className='text-primary inline-flex items-center gap-1 text-xs font-medium hover:underline'
                        >
                          <Icons.receipt className='size-3.5' />
                          Bukti transfer
                        </a>
                      )}
                    </div>
                  </td>
                  <td className='px-6 py-4 text-right'>{recapButton(r)}</td>
                </tr>
              ))}
              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan={7} className='text-muted-foreground py-12 text-center'>
                    {recapped === 'false' ? 'Semua reimbursement yang dibayar sudah direkap.' : 'Tidak ada data untuk filter ini.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {loading && items.length === 0 && (
            <div className='space-y-2 p-6'>
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className='h-12 w-full' />)}
            </div>
          )}
        </div>

        <div className='flex items-center justify-between gap-3 border-t px-6 py-3.5'>
          <span className='text-muted-foreground text-sm'>{count} data</span>
          <div className='flex items-center gap-2'>
            <Button variant='outline' size='icon' disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)} aria-label='Halaman sebelumnya'>
              <Icons.chevronLeft className='size-4' />
            </Button>
            <span className='text-sm tabular-nums'>
              {page} / {totalPages}
            </span>
            <Button variant='outline' size='icon' disabled={page >= totalPages || loading} onClick={() => setPage((p) => p + 1)} aria-label='Halaman berikutnya'>
              <Icons.chevronRight className='size-4' />
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
