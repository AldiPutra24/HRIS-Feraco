'use client';

import { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';
import { downloadMyContractDocument, getHrContact } from '@/lib/employee-self';
import type { Contract, Employee } from '@/lib/employees';
import { useMyEmployee } from './use-my-employee';

const STATUS: Record<string, { label: string; className: string }> = {
  ACTIVE: { label: 'Aktif', className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300' },
  EXPIRED: { label: 'Berakhir', className: 'bg-muted text-muted-foreground' },
  RENEWED: { label: 'Diperpanjang', className: 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300' },
  TERMINATED: { label: 'Diberhentikan', className: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300' },
  DRAFT: { label: 'Draft', className: 'bg-muted text-muted-foreground' }
};

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

function contractType(c: Contract): string {
  return c.contract_type === 'PKWT' && c.pkwt_sequence ? `PKWT ${c.pkwt_sequence}` : c.contract_type;
}

function daysUntil(iso: string): number {
  const end = new Date(`${iso}T00:00:00`).getTime();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((end - today.getTime()) / 86_400_000);
}

/** mailto: with the context HR needs to look the employee up. */
function hrMailto(email: string, employee: Employee, latest: Contract | null): string {
  const subject = `Pertanyaan status kontrak - ${employee.full_name} (${employee.employee_id})`;
  const body = [
    'Halo tim HR,',
    '',
    'Saya ingin menanyakan status kontrak kerja saya.',
    '',
    `Nama: ${employee.full_name}`,
    `ID Karyawan: ${employee.employee_id}`,
    `Posisi: ${[employee.position_name, employee.department_name].filter(Boolean).join(' - ') || '-'}`,
    latest
      ? `Kontrak terakhir: ${contractType(latest)}, ${fmtDate(latest.start_date)} - ${latest.end_date ? fmtDate(latest.end_date) : 'tanpa tanggal berakhir'}`
      : 'Kontrak terakhir: belum ada data',
    '',
    'Terima kasih.'
  ].join('\n');
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function HrButton({ href }: { href: string | null }) {
  return href ? (
    <a href={href} className={cn(buttonVariants({ variant: 'outline' }), 'h-11 px-4')}>
      <Icons.chat className='size-4' />
      Hubungi HR
    </a>
  ) : (
    <span
      className={cn(buttonVariants({ variant: 'outline' }), 'pointer-events-none h-11 px-4 opacity-50')}
      title='Email HR belum diatur'
    >
      <Icons.chat className='size-4' />
      Hubungi HR
    </span>
  );
}

export function EmployeeContractPage() {
  const { employee, contracts, loading, error } = useMyEmployee();
  const [hrEmail, setHrEmail] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<number | null>(null);

  useEffect(() => {
    getHrContact()
      .then((d) => setHrEmail(d.email))
      .catch(() => setHrEmail(null));
  }, []);

  if (error) {
    return (
      <div className='p-4 md:p-8'>
        <p className='text-destructive'>{error}</p>
      </div>
    );
  }

  if (loading || !employee) {
    return (
      <div className='space-y-2 p-4 md:p-8'>
        <Skeleton className='h-8 w-64' />
        <Skeleton className='h-40 w-full' />
      </div>
    );
  }

  const current = contracts.find((c) => c.is_current) ?? null;
  const accumulation = employee.contract_accumulation;
  const countedContracts = accumulation?.contracts.filter((c) => c.counted !== false).length ?? 0;
  // Oldest first for "Kontrak ke-N", shown newest first.
  const chronological = [...contracts].sort((a, b) => a.start_date.localeCompare(b.start_date));
  const history = [...chronological].reverse();
  const latest = history[0] ?? null;
  const mailto = hrEmail ? hrMailto(hrEmail, employee, latest) : null;
  const left = current?.end_date ? daysUntil(current.end_date) : null;
  // "2 bulan" -> big number + unit; longer texts ("1 tahun 3 bulan") stay whole.
  const accParts = accumulation?.display?.match(/^(\d+)\s+(\S+)$/);

  async function download(c: Contract) {
    setDownloading(c.id);
    try {
      await downloadMyContractDocument(c.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal mengunduh dokumen kontrak.');
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className='flex flex-1 flex-col gap-6 p-4 md:p-8'>
      <div>
        <h2 className='text-3xl font-bold tracking-tight'>Kontrak</h2>
        <p className='text-muted-foreground mt-1'>Status kontrak kerja Anda saat ini dan riwayat kontrak sebelumnya.</p>
      </div>

      <div className='grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]'>
        <div className='flex min-w-0 flex-col gap-6'>
          <Card className='px-6 py-6'>
            <div className='flex flex-col gap-5 md:flex-row md:items-center'>
              <span
                className={cn(
                  'flex size-14 shrink-0 items-center justify-center rounded-2xl',
                  current ? 'bg-primary/10 text-primary' : 'bg-orange-500/10 text-orange-700 dark:text-orange-300'
                )}
              >
                {current ? <Icons.badgeCheck className='size-6' /> : <Icons.alertCircle className='size-6' />}
              </span>
              <div className='min-w-0 flex-1'>
                {current ? (
                  <>
                    <span className='inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300'>
                      <span className='size-1.5 rounded-full bg-emerald-600' />
                      Kontrak aktif
                    </span>
                    <h3 className='mt-2 text-xl font-semibold'>
                      {contractType(current)} ·{' '}
                      {current.end_date ? `berlaku sampai ${fmtDate(current.end_date)}` : 'tanpa tanggal berakhir'}
                    </h3>
                    <p className='text-muted-foreground mt-1'>
                      Mulai {fmtDate(current.start_date)}
                      {current.duration_display ? ` · ${current.duration_display}` : ''}
                      {left !== null && left >= 0 && (
                        <span className={cn(left <= 60 && 'font-medium text-orange-700 dark:text-orange-300')}>
                          {' '}
                          · sisa {left} hari
                        </span>
                      )}
                    </p>
                  </>
                ) : (
                  <>
                    <span className='inline-flex items-center gap-1.5 rounded-full bg-orange-500/10 px-2.5 py-0.5 text-xs font-semibold text-orange-700 dark:text-orange-300'>
                      <span className='size-1.5 rounded-full bg-orange-600' />
                      Tidak ada kontrak aktif
                    </span>
                    <h3 className='mt-2 text-xl font-semibold'>Kontrak Anda belum tercatat aktif</h3>
                    <p className='text-muted-foreground mt-1 max-w-2xl'>
                      Kontrak terakhir Anda mungkin sudah berakhir atau perpanjangan belum diinput. Hubungi tim HR untuk
                      memastikan status kepegawaian Anda.
                    </p>
                  </>
                )}
              </div>
              <HrButton href={mailto} />
            </div>
          </Card>

          <Card className='gap-0 px-6 py-6'>
            <div className='flex items-start justify-between gap-3'>
              <div>
                <h3 className='text-lg font-semibold'>Riwayat Kontrak</h3>
                <p className='text-muted-foreground mt-0.5 text-sm'>Urut dari yang terbaru</p>
              </div>
              <span className='bg-muted rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums'>
                {contracts.length} kontrak
              </span>
            </div>
            {history.length === 0 ? (
              <p className='text-muted-foreground mt-5 text-sm'>Belum ada data kontrak.</p>
            ) : (
              <ol className='mt-5'>
                {history.map((c, i) => {
                  const st = STATUS[c.status] ?? { label: c.status, className: 'bg-muted text-muted-foreground' };
                  const last = i === history.length - 1;
                  return (
                    <li key={c.id} className='relative flex gap-4 pb-6 last:pb-0'>
                      {!last && <span className='bg-border absolute top-5 bottom-0 left-[7px] w-0.5' aria-hidden />}
                      <span
                        className={cn(
                          'relative mt-1 size-4 shrink-0 rounded-full border-2',
                          c.is_current ? 'border-primary bg-primary' : 'border-muted-foreground/50 bg-background'
                        )}
                        aria-hidden
                      />
                      <div className='flex min-w-0 flex-1 flex-wrap items-start justify-between gap-3'>
                        <div className='min-w-0'>
                          <p className='font-semibold'>
                            Kontrak ke-{chronological.indexOf(c) + 1} · {contractType(c)}
                          </p>
                          <p className='text-muted-foreground text-sm'>
                            {fmtDate(c.start_date)} – {c.end_date ? fmtDate(c.end_date) : 'sekarang'}
                            {c.duration_display ? ` · ${c.duration_display}` : ''}
                          </p>
                          {c.status === 'TERMINATED' && c.termination_date && (
                            <p className='text-muted-foreground text-xs'>Diberhentikan {fmtDate(c.termination_date)}</p>
                          )}
                        </div>
                        <div className='flex shrink-0 items-center gap-2'>
                          <span className={cn('rounded-full px-2.5 py-1 text-xs font-medium', st.className)}>{st.label}</span>
                          {c.document && (
                            <button
                              type='button'
                              onClick={() => download(c)}
                              disabled={downloading === c.id}
                              aria-label={`Unduh dokumen kontrak ke-${chronological.indexOf(c) + 1}`}
                              title='Unduh dokumen kontrak'
                              className={cn(buttonVariants({ variant: 'outline', size: 'icon' }), 'size-10')}
                            >
                              {downloading === c.id ? (
                                <Icons.spinner className='size-4 animate-spin' />
                              ) : (
                                <Icons.download className='size-4' />
                              )}
                            </button>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </Card>
        </div>

        <div className='flex min-w-0 flex-col gap-6'>
          <Card className='bg-primary text-primary-foreground gap-5 border-0 px-6 py-6 ring-0'>
            <div className='flex items-center justify-between font-medium'>
              <span>Akumulasi Masa Kontrak</span>
              <Icons.clock className='size-5 opacity-90' />
            </div>
            {accParts ? (
              <p className='flex items-baseline gap-2'>
                <span className='text-6xl font-semibold tabular-nums'>{accParts[1]}</span>
                <span className='text-xl font-medium'>{accParts[2]}</span>
              </p>
            ) : (
              <p className='text-3xl font-semibold'>{accumulation?.display || '—'}</p>
            )}
            <div className='grid grid-cols-2 gap-3'>
              <div className='rounded-xl bg-white/10 px-4 py-3'>
                <p className='text-sm opacity-90'>Jumlah kontrak</p>
                <p className='mt-1 text-xl font-semibold tabular-nums'>{countedContracts}</p>
              </div>
              <div className='rounded-xl bg-white/10 px-4 py-3'>
                <p className='text-sm opacity-90'>Dihitung sampai</p>
                <p className='mt-1 text-xl font-semibold'>
                  {new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                </p>
              </div>
            </div>
            {accumulation?.contracts.some((c) => c.overlap) && (
              <p className='text-xs opacity-90'>Periode kontrak yang tumpang tindih tidak dihitung ganda.</p>
            )}
          </Card>

          <Card className='gap-4 px-6 py-6'>
            <h3 className='font-semibold'>Data kepegawaian</h3>
            {[
              ['Posisi', employee.position_name],
              ['Department', employee.department_name],
              ['Atasan', employee.manager_name]
            ].map(([label, value]) => (
              <div key={label} className='flex items-start justify-between gap-4'>
                <span className='text-muted-foreground'>{label}</span>
                <span className='text-right font-medium'>{value || '—'}</span>
              </div>
            ))}
          </Card>

          <Card className='flex-row items-start gap-3 px-6 py-5'>
            <Icons.info className='mt-0.5 size-5 shrink-0 text-blue-700 dark:text-blue-300' />
            <p className='text-sm'>
              Data kontrak tidak sesuai?{' '}
              {mailto ? (
                <a href={mailto} className='font-medium underline underline-offset-2'>
                  Hubungi tim HR
                </a>
              ) : (
                'Hubungi tim HR'
              )}{' '}
              untuk pembaruan.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
