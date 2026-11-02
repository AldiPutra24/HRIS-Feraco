'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'react-toastify';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Icons } from '@/components/icons';
import { LinkifiedText } from '@/components/linkified-text';
import { cn } from '@/lib/utils';
import {
  cancelReimbursement,
  getReimbursementSummary,
  listReimbursements,
  REIMBURSEMENT_PAGE_SIZE,
  REIMBURSEMENT_TEMPLATE_URL,
  reimbursementProjectLabel,
  reimbursementStatusLabel,
  type Reimbursement,
  type ReimbursementSummary
} from '@/lib/reimbursements';
import { AttachmentCell } from './attachment-cell';

type Filter = 'ALL' | 'PENDING' | 'APPROVED' | 'PAID' | 'REJECTED';

// "Pending" covers both approval layers (HR Staff, then HR Lead).
const FILTERS: { value: Filter; label: string; params: Record<string, string> }[] = [
  { value: 'ALL', label: 'Semua', params: {} },
  { value: 'PENDING', label: 'Pending', params: { status_in: 'PENDING,WAITING_HR_LEAD' } },
  { value: 'APPROVED', label: 'Disetujui', params: { status: 'APPROVED' } },
  { value: 'PAID', label: 'Dibayar', params: { status: 'PAID' } },
  { value: 'REJECTED', label: 'Ditolak', params: { status: 'REJECTED' } }
];

const STATUS_TONE: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  WAITING_HR_LEAD: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  APPROVED: 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300',
  PAID: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
  REJECTED: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300'
};

const STEPS = [
  { title: 'Ajukan', text: 'Isi detail transaksi dan lampirkan bukti pembayaran.' },
  { title: 'Diverifikasi', text: 'Tim HR/Finance memeriksa klaim dan menetapkan nominal.' },
  { title: 'Ditransfer', text: 'Dana dikirim ke rekening Anda, konfirmasi via email.' }
];

function rupiah(n: number | string | null | undefined): string {
  return `Rp ${Math.round(Number(n) || 0).toLocaleString('id-ID')}`;
}

function fmtDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** "Pengajuan Saya" reimbursement page (Employee and Management self-service). */
export function EmployeeReimbursement({ newHref = '/dashboard/employee/reimbursement/new' }: { newHref?: string }) {
  const [items, setItems] = useState<Reimbursement[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [summary, setSummary] = useState<ReimbursementSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [initialised, setInitialised] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const params = FILTERS.find((f) => f.value === filter)?.params ?? {};
    const [r, s] = await Promise.all([
      // `mine=1`: own records only (also for HR in employee mode), paginated.
      listReimbursements({ mine: '1', page: String(page), ...params }),
      getReimbursementSummary(true).catch(() => null)
    ]);
    setItems(r.results);
    setCount(r.count);
    setSummary(s);
    setLoading(false);
    setInitialised(true);
  }, [page, filter]);

  useEffect(() => {
    load();
  }, [load]);

  async function cancel(r: Reimbursement) {
    if (!window.confirm(r.status === 'DRAFT' ? 'Hapus draft ini?' : 'Batalkan pengajuan ini?')) return;
    try {
      await cancelReimbursement(r.id);
      toast.success(r.status === 'DRAFT' ? 'Draft dihapus.' : 'Pengajuan dibatalkan.');
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal membatalkan.');
    }
  }

  if (!initialised) {
    return (
      <div className='space-y-2 p-4 md:p-8'>
        <Skeleton className='h-8 w-64' />
        <Skeleton className='h-40 w-full' />
      </div>
    );
  }

  // KPI from the backend summary (not the current page of the list).
  const pendingCount = (summary?.counts.PENDING ?? 0) + (summary?.counts.WAITING_HR_LEAD ?? 0);
  const year = new Date().getFullYear();
  const totalPages = Math.max(1, Math.ceil(count / REIMBURSEMENT_PAGE_SIZE));

  return (
    <div className='flex flex-1 flex-col gap-6 p-4 md:p-8'>
      <div className='flex flex-wrap items-start justify-between gap-4'>
        <div>
          <h2 className='text-3xl font-bold tracking-tight'>Reimbursement</h2>
          <p className='text-muted-foreground mt-1'>Ajukan klaim biaya kerja dan pantau sampai dana ditransfer.</p>
        </div>
        <Link href={newHref} className={cn(buttonVariants({ size: 'lg' }), 'h-11 px-5')}>
          <Icons.plus className='size-4' />
          Ajukan Reimbursement
        </Link>
      </div>

      <div className='grid gap-4 md:grid-cols-3'>
        <Card className='gap-3 px-6 py-6'>
          <div className='text-muted-foreground flex items-center justify-between text-sm'>
            <span>Menunggu Persetujuan</span>
            <Icons.clock className='size-5' />
          </div>
          <p className='flex items-baseline gap-2'>
            <span className='text-4xl font-semibold tabular-nums'>{pendingCount}</span>
            <span>pengajuan</span>
          </p>
          <p className='text-muted-foreground text-sm'>Senilai {rupiah(summary?.pending_amount)}</p>
        </Card>
        <Card className='gap-3 px-6 py-6'>
          <div className='text-muted-foreground flex items-center justify-between text-sm'>
            <span>Total Dibayar</span>
            <Icons.wallet className='size-5' />
          </div>
          <p className='flex items-baseline gap-1.5'>
            <span className='text-lg'>Rp</span>
            <span className='text-4xl font-semibold tabular-nums'>
              {Math.round(Number(summary?.paid_this_year ?? 0)).toLocaleString('id-ID')}
            </span>
          </p>
          <p className='text-muted-foreground text-sm'>Sepanjang tahun {year}</p>
        </Card>
        <a
          href={REIMBURSEMENT_TEMPLATE_URL}
          target='_blank'
          rel='noopener noreferrer'
          className='bg-card hover:bg-muted/40 flex items-center gap-4 rounded-xl border border-dashed px-6 py-6 transition-colors'
        >
          <span className='flex size-12 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-blue-700 dark:text-blue-300'>
            <Icons.download className='size-5' />
          </span>
          <span>
            <span className='block font-semibold'>Template Pengajuan</span>
            <span className='text-muted-foreground block text-sm'>Unduh untuk merangkum lebih dari 1 bukti transaksi</span>
          </span>
        </a>
      </div>

      <Card className='gap-0 py-0'>
        <div className='flex flex-wrap items-center justify-between gap-3 px-6 py-5'>
          <h3 className='text-lg font-semibold'>Riwayat Pengajuan</h3>
          <div className='flex flex-wrap gap-2'>
            {FILTERS.map((f) => (
              <button
                key={f.value}
                type='button'
                onClick={() => {
                  setFilter(f.value);
                  setPage(1);
                }}
                className={cn(
                  'rounded-lg border px-3.5 py-1.5 text-sm transition-colors',
                  filter === f.value ? 'bg-foreground text-background border-foreground font-medium' : 'hover:bg-muted'
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className='overflow-x-auto border-t'>
          <table className='w-full text-sm'>
            <thead className='bg-muted/40 text-muted-foreground text-left'>
              <tr>
                <th className='px-6 py-3 font-medium'>Kategori &amp; Deskripsi</th>
                <th className='px-4 py-3 font-medium'>Project</th>
                <th className='px-4 py-3 font-medium'>Tgl Transaksi</th>
                <th className='px-4 py-3 text-right font-medium'>Jumlah</th>
                <th className='px-6 py-3 text-right font-medium'>Status</th>
              </tr>
            </thead>
            {items.length > 0 && (
              <tbody className={cn('divide-y', loading && 'opacity-60')}>
                {items.map((r) => (
                  <tr key={r.id} className='align-top'>
                    <td className='px-6 py-4'>
                      <p className='font-medium'>{r.category_name}</p>
                      {r.description && (
                        <LinkifiedText
                          text={r.description}
                          className='text-muted-foreground line-clamp-2 max-w-md text-xs break-words'
                        />
                      )}
                      <div className='mt-1.5 flex flex-wrap items-center gap-3'>
                        <AttachmentCell r={r} />
                        {r.payment_proof_url && (
                          <a
                            href={r.payment_proof_url}
                            target='_blank'
                            rel='noreferrer'
                            className='text-primary inline-flex items-center gap-1 text-xs font-medium hover:underline'
                          >
                            <Icons.receipt className='size-3.5' />
                            {r.payment_proof_name || 'Bukti transfer'}
                          </a>
                        )}
                      </div>
                      {r.status === 'REJECTED' && r.rejection_reason && (
                        <p className='text-destructive mt-1 max-w-md text-xs'>Alasan ditolak: {r.rejection_reason}</p>
                      )}
                    </td>
                    <td className='px-4 py-4'>{reimbursementProjectLabel(r)}</td>
                    <td className='px-4 py-4 whitespace-nowrap'>{fmtDate(r.transaction_date)}</td>
                    <td className='px-4 py-4 text-right whitespace-nowrap tabular-nums'>
                      <p className='font-medium'>{rupiah(r.amount)}</p>
                      {r.approved_amount != null && Number(r.approved_amount) !== Number(r.amount) && (
                        <p className='text-muted-foreground text-xs'>Disetujui {rupiah(r.approved_amount)}</p>
                      )}
                    </td>
                    <td className='px-6 py-4 text-right'>
                      <span
                        className={cn(
                          'inline-flex rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap',
                          STATUS_TONE[r.status] ?? 'bg-muted text-muted-foreground'
                        )}
                      >
                        {reimbursementStatusLabel(r)}
                      </span>
                      {(r.status === 'DRAFT' || r.status === 'PENDING') && (
                        <div className='mt-1'>
                          <Button size='sm' variant='ghost' className='h-7 px-2 text-xs' onClick={() => cancel(r)}>
                            {r.status === 'DRAFT' ? 'Hapus' : 'Batalkan'}
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            )}
          </table>
          {items.length === 0 && (
            <div className='flex flex-col items-center gap-2 px-6 py-14 text-center'>
              <span className='bg-muted mb-2 flex size-14 items-center justify-center rounded-2xl'>
                <Icons.receipt className='text-muted-foreground size-6' />
              </span>
              <p className='font-semibold'>
                {filter === 'ALL' ? 'Belum ada pengajuan' : 'Tidak ada pengajuan di filter ini'}
              </p>
              <p className='text-muted-foreground max-w-md text-sm'>
                Klaim yang Anda kirim akan muncul di sini, dari pengajuan sampai dana ditransfer ke rekening Anda.
              </p>
              {filter === 'ALL' && (
                <Link href={newHref} className={cn(buttonVariants({ variant: 'outline' }), 'mt-3')}>
                  <Icons.plus className='size-4' />
                  Buat klaim pertama
                </Link>
              )}
            </div>
          )}
        </div>

        <div className='flex items-center justify-between gap-3 border-t px-6 py-3.5'>
          <span className='text-muted-foreground text-sm'>{count} data</span>
          <div className='flex items-center gap-2'>
            <Button
              variant='outline'
              size='icon'
              onClick={() => setPage((p) => p - 1)}
              disabled={page <= 1 || loading}
              aria-label='Halaman sebelumnya'
            >
              <Icons.chevronLeft className='size-4' />
            </Button>
            <span className='text-sm tabular-nums'>
              {page} / {totalPages}
            </span>
            <Button
              variant='outline'
              size='icon'
              onClick={() => setPage((p) => p + 1)}
              disabled={page >= totalPages || loading}
              aria-label='Halaman berikutnya'
            >
              <Icons.chevronRight className='size-4' />
            </Button>
          </div>
        </div>
      </Card>

      <Card className='gap-4 px-6 py-6'>
        <h3 className='font-semibold'>Alur reimbursement</h3>
        <div className='grid gap-5 md:grid-cols-3'>
          {STEPS.map((s, i) => (
            <div key={s.title} className='flex items-start gap-3'>
              <span className='bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg text-sm font-semibold'>
                {i + 1}
              </span>
              <div>
                <p className='font-semibold'>{s.title}</p>
                <p className='text-muted-foreground text-sm'>{s.text}</p>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
