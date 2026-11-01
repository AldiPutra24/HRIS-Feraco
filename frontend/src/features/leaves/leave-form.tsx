'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'react-toastify';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  cancelLeave,
  createLeaveRequest,
  formatDays,
  getMyBalances,
  listLeaveTypes,
  uploadLeaveAttachment,
  type LeaveType,
  type MyBalance
} from '@/lib/leaves';
import { getMyEmployee } from '@/lib/employee-self';
import type { Employee } from '@/lib/employees';
import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';
import { MultiDateCalendar, formatIsoShort } from './multi-date-calendar';

// Same as nginx client_max_body_size (deploy/nginx-hris.conf).
const FILE_MAX_MB = 20;
const FILE_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png'];

const KINDS = [
  { value: 'LEAVE', label: 'Cuti', hint: 'Libur terencana, memotong kuota sesuai kategori' },
  { value: 'PERMISSION', label: 'Izin', hint: 'Sakit atau keperluan mendadak' }
] as const;

/** 'YYYY-MM-DD' + n days, in local time (no UTC shift). */
function isoPlusDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function fileError(f: File): string | null {
  const name = f.name.toLowerCase();
  if (!FILE_EXTENSIONS.some((ext) => name.endsWith(ext))) return 'Format dokumen harus PDF, JPG atau PNG.';
  if (f.size > FILE_MAX_MB * 1024 * 1024) return `Ukuran dokumen maksimal ${FILE_MAX_MB} MB.`;
  return null;
}

function initials(name: string): string {
  return name
    .replace(/\(.*?\)/g, ' ')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

function Step({ n, title, hint, required, children }: { n: number; title: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <Card className='gap-5 px-6 py-6'>
      <div className='flex flex-wrap items-center gap-x-3 gap-y-1'>
        <span className='bg-foreground text-background flex size-7 items-center justify-center rounded-md text-sm font-semibold'>
          {n}
        </span>
        <h3 className='text-base font-semibold'>
          {title}
          {required && <span className='text-destructive'> *</span>}
        </h3>
        {hint && <span className='text-muted-foreground text-sm'>{hint}</span>}
      </div>
      {children}
    </Card>
  );
}

function SummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className='flex items-start justify-between gap-3 text-sm'>
      <span className='text-muted-foreground'>{label}</span>
      <span className='text-right font-medium'>{value}</span>
    </div>
  );
}

export function LeaveForm({ redirectTo = '/dashboard/leave' }: { redirectTo?: string }) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<'LEAVE' | 'PERMISSION'>('LEAVE');
  const [form, setForm] = useState({
    leave_type: '',
    reason: ''
  });
  // Individually picked leave days (non-consecutive allowed).
  const [dates, setDates] = useState<string[]>([]);
  // Days taken as Half Day (0,5) — Cuti Tahunan only.
  const [halfDays, setHalfDays] = useState<string[]>([]);
  const [myBalances, setMyBalances] = useState<MyBalance[]>([]);
  const now = new Date();
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [me, setMe] = useState<Employee | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [t, emp, b] = await Promise.all([
      listLeaveTypes(),
      getMyEmployee().catch(() => null),
      getMyBalances().catch(() => [] as MyBalance[])
    ]);
    setTypes(t);
    setMe(emp);
    setMyBalances(b);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function pickFile(f: File | null) {
    if (!f) return;
    const problem = fileError(f);
    if (problem) {
      toast.error(problem);
      return;
    }
    setFile(f);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return; // prevent double-click/spam
    if (!form.leave_type || dates.length === 0 || !form.reason.trim()) {
      toast.error('Lengkapi kategori, tanggal (minimal 1 hari), dan alasan pengajuan.');
      return;
    }
    if (!file) {
      toast.error('Berkas/Dokumen Pendukung wajib dilampirkan.');
      return;
    }
    if (dates.some((d) => d < todayIso)) {
      toast.error('Tidak dapat mengajukan untuk tanggal sebelum hari ini.');
      return;
    }
    const type = types.find((t) => t.id === Number(form.leave_type));
    const minNotice = type?.min_notice_days ?? 0;
    if (minNotice > 0 && dates.some((d) => d < isoPlusDays(todayIso, minNotice))) {
      toast.error(
        `${type?.name} wajib diajukan paling lambat H-${minNotice}. Tanggal paling awal: ${formatIsoShort(isoPlusDays(todayIso, minNotice))}.`
      );
      return;
    }
    setSubmitting(true);
    try {
      const created = await createLeaveRequest({
        leave_type: Number(form.leave_type),
        kind,
        dates,
        half_days: halfDayAllowed ? halfDays.filter((d) => dates.includes(d)) : [],
        reason: form.reason,
        // Required. Sent up front so the "pengajuan baru" email already names
        // the file; the binary follows in the upload call below.
        attachment_name: file.name
      });
      try {
        await uploadLeaveAttachment(created.id, file);
      } catch (err) {
        // Never leave a request without its document: cancel and let the user retry.
        await cancelLeave(created.id).catch(() => undefined);
        throw new Error(
          `Upload berkas gagal, pengajuan dibatalkan. Silakan ajukan ulang. (${err instanceof Error ? err.message : 'error'})`
        );
      }
      toast.success('Pengajuan cuti berhasil dibuat');
      router.push(redirectTo);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal mengirim pengajuan.');
      setSubmitting(false); // re-enable so user can retry
    }
  }

  const selectedType = types.find((t) => t.id === Number(form.leave_type));
  // Minimum notice (e.g. paling lambat H-7): earliest selectable leave day.
  const noticeDays = selectedType?.min_notice_days ?? 0;
  const earliestIso = noticeDays > 0 ? isoPlusDays(todayIso, noticeDays) : todayIso;

  // Switching to a category with a notice rule drops days it no longer allows.
  useEffect(() => {
    if (!dates.some((d) => d < earliestIso)) return;
    setDates((ds) => ds.filter((d) => d >= earliestIso));
    toast.info(`Tanggal sebelum ${formatIsoShort(earliestIso)} dihapus karena aturan minimal pengajuan.`);
    // Only re-check when the rule changes (category switch), not on each pick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [earliestIso]);
  // Full Day / Half Day applies to Cuti Tahunan.
  const halfDayAllowed = selectedType?.code === 'ANNUAL';
  const effectiveHalf = halfDayAllowed ? halfDays.filter((d) => dates.includes(d)) : [];
  const totalDays = dates.length - effectiveHalf.length * 0.5;
  const quotaTypeId = selectedType ? (selectedType.deducts_from ?? selectedType.id) : null;
  const quota = myBalances.find((b) => b.leave_type === quotaTypeId) ?? null;
  // Without a quota for the chosen category, show the annual balance unchanged.
  const shownQuota = quota ?? myBalances.find((b) => b.leave_type_code === 'ANNUAL') ?? null;
  const remainingNow = shownQuota?.remaining_days ?? 0;
  const remainingAfter = quota ? remainingNow - totalDays : remainingNow;
  const overQuota = !!quota && remainingAfter < 0;
  const managerName = me?.manager_name || '';
  const missing = [!form.leave_type && 'kategori', dates.length === 0 && 'tanggal', !form.reason.trim() && 'alasan', !file && 'dokumen']
    .filter(Boolean)
    .join(', ');

  function togglePortion(d: string) {
    setHalfDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  }

  if (loading) {
    return (
      <div className='space-y-2 p-4 md:p-6'>
        <Skeleton className='h-8 w-64' />
        <Skeleton className='h-40 w-full' />
      </div>
    );
  }

  const dateSummary =
    dates.length === 0
      ? '—'
      : dates.length === 1
        ? formatIsoShort(dates[0])
        : `${formatIsoShort(dates[0])} – ${formatIsoShort(dates[dates.length - 1])}`;

  return (
    <div className='flex flex-1 flex-col gap-6 p-4 md:p-8'>
      <div className='space-y-3'>
        <Link href={redirectTo} className='text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm'>
          <Icons.arrowLeft className='size-4' />
          Kembali ke Izin &amp; Cuti
        </Link>
        <div>
          <h2 className='text-3xl font-bold tracking-tight'>Pengajuan Izin / Cuti</h2>
          <p className='text-muted-foreground mt-1'>Lengkapi tiga langkah di bawah. Ringkasan di sebelah kanan ikut terisi otomatis.</p>
        </div>
      </div>

      <form onSubmit={submit} className='grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]'>
        <div className='space-y-6'>
          <Step n={1} title='Jenis pengajuan'>
            <div className='grid gap-3 sm:grid-cols-2'>
              {KINDS.map((k) => {
                const active = kind === k.value;
                return (
                  <label
                    key={k.value}
                    className={cn(
                      'flex cursor-pointer items-start gap-3 rounded-xl border-2 px-4 py-3.5 transition-colors',
                      active ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40'
                    )}
                  >
                    <input
                      type='radio'
                      name='kind'
                      value={k.value}
                      checked={active}
                      onChange={() => {
                        setKind(k.value);
                        setForm((f) => ({ ...f, leave_type: '' }));
                      }}
                      className='accent-primary mt-1 size-4'
                    />
                    <span>
                      <span className='block font-semibold'>{k.label}</span>
                      <span className='text-muted-foreground block text-sm'>{k.hint}</span>
                    </span>
                  </label>
                );
              })}
            </div>
            <div className='grid gap-4 sm:grid-cols-2'>
              <div className='space-y-1.5'>
                <Label htmlFor='leave-type'>
                  Kategori <span className='text-destructive'>*</span>
                </Label>
                <select
                  id='leave-type'
                  className='border-input bg-background h-10 w-full rounded-lg border px-3 text-sm'
                  value={form.leave_type}
                  onChange={(e) => setForm((f) => ({ ...f, leave_type: e.target.value }))}
                >
                  <option value=''>Pilih kategori</option>
                  {types
                    .filter((t) => t.is_active && t.kind === kind)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                </select>
              </div>
              <div className='space-y-1.5'>
                <Label>Disetujui oleh</Label>
                <div className='bg-muted/50 flex h-10 items-center gap-2.5 rounded-lg border px-3 text-sm'>
                  {managerName ? (
                    <>
                      <span className='bg-background text-muted-foreground flex size-6 items-center justify-center rounded-full border text-[10px] font-semibold'>
                        {initials(managerName)}
                      </span>
                      <span className='min-w-0 flex-1 truncate font-medium'>{managerName}</span>
                      <span className='text-muted-foreground text-xs'>Atasan langsung</span>
                    </>
                  ) : (
                    <span className='text-muted-foreground'>Belum ditentukan</span>
                  )}
                </div>
              </div>
            </div>
          </Step>

          <Step n={2} title='Pilih tanggal' required hint='Klik untuk memilih; boleh tidak berurutan.'>
            <div className='grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]'>
              <MultiDateCalendar value={dates} onChange={setDates} minDate={earliestIso} />
              <div className='space-y-3'>
                <p className='flex items-baseline gap-2'>
                  <span className='text-5xl font-semibold tabular-nums'>{formatDays(totalDays)}</span>
                  <span className='text-lg'>hari dipilih</span>
                </p>
                {noticeDays > 0 && (
                  <p className='rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300'>
                    {selectedType?.name} wajib diajukan <span className='font-semibold'>paling lambat H-{noticeDays}</span>. Tanggal paling
                    awal: <span className='font-semibold'>{formatIsoShort(earliestIso)}</span>.
                  </p>
                )}
                {dates.length === 0 ? (
                  <p className='text-muted-foreground text-sm'>Belum ada tanggal dipilih. Tanggal sebelum hari ini tidak bisa dipilih.</p>
                ) : (
                  <>
                    {halfDayAllowed && (
                      <p className='text-muted-foreground text-xs'>Klik Full/Half pada tiap tanggal (Full Day = 1, Half Day = 0,5).</p>
                    )}
                    <div className='flex flex-wrap gap-1.5'>
                      {dates.map((d) => (
                        <span key={d} className='bg-muted flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium'>
                          {formatIsoShort(d)}
                          {halfDayAllowed && (
                            <button
                              type='button'
                              onClick={() => togglePortion(d)}
                              className='bg-background rounded-full border px-1.5 text-[10px] font-semibold'
                              aria-label={`Ubah Full/Half Day ${d}`}
                            >
                              {halfDays.includes(d) ? 'Half' : 'Full'}
                            </button>
                          )}
                          <button
                            type='button'
                            aria-label={`Hapus ${d}`}
                            onClick={() => setDates((prev) => prev.filter((x) => x !== d))}
                            className='text-muted-foreground hover:text-foreground'
                          >
                            <Icons.close className='size-3' />
                          </button>
                        </span>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          </Step>

          <Step n={3} title='Alasan & dokumen'>
            <div className='space-y-1.5'>
              <Label htmlFor='leave-reason'>
                Alasan pengajuan <span className='text-destructive'>*</span>
              </Label>
              <textarea
                id='leave-reason'
                rows={4}
                placeholder='Contoh: Acara keluarga di luar kota'
                className='border-input bg-background w-full rounded-lg border px-3 py-2.5 text-sm'
                value={form.reason}
                onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
              />
            </div>
            <div className='space-y-1.5'>
              <Label>
                Dokumen pendukung <span className='text-destructive'>*</span>
              </Label>
              <div
                role='button'
                tabIndex={0}
                onClick={() => fileInput.current?.click()}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && fileInput.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  pickFile(e.dataTransfer.files?.[0] ?? null);
                }}
                className={cn(
                  'flex cursor-pointer items-center gap-4 rounded-xl border border-dashed px-4 py-4 transition-colors',
                  dragging ? 'border-primary bg-primary/5' : 'bg-muted/30 hover:bg-muted/50'
                )}
              >
                <span className='bg-background flex size-11 shrink-0 items-center justify-center rounded-lg border'>
                  <Icons.upload className='size-5' />
                </span>
                <span className='min-w-0 flex-1'>
                  {file ? (
                    <>
                      <span className='block truncate font-medium'>{file.name}</span>
                      <span className='text-muted-foreground block text-xs'>{(file.size / 1024 / 1024).toFixed(2)} MB · klik untuk mengganti</span>
                    </>
                  ) : (
                    <>
                      <span className='block font-medium'>Klik untuk unggah atau seret file ke sini</span>
                      <span className='text-muted-foreground block text-xs'>PDF, JPG atau PNG · maks. {FILE_MAX_MB} MB</span>
                    </>
                  )}
                </span>
                {file ? (
                  <Button
                    type='button'
                    variant='ghost'
                    size='sm'
                    aria-label='Hapus file'
                    onClick={(e) => {
                      e.stopPropagation();
                      setFile(null);
                      if (fileInput.current) fileInput.current.value = '';
                    }}
                  >
                    <Icons.close className='size-4' />
                  </Button>
                ) : (
                  <span className='bg-background shrink-0 rounded-lg border px-4 py-2 text-sm font-medium'>Pilih file</span>
                )}
              </div>
              <input
                ref={fileInput}
                type='file'
                className='hidden'
                accept='.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png'
                onChange={(e) => {
                  pickFile(e.target.files?.[0] ?? null);
                  e.target.value = '';
                }}
              />
            </div>
            <p className='flex items-start gap-2 rounded-lg bg-sky-50 px-4 py-3 text-sm text-sky-900 dark:bg-sky-950/40 dark:text-sky-200'>
              <Icons.info className='mt-0.5 size-4 shrink-0' />
              {kind === 'LEAVE'
                ? 'Lampirkan dokumen pendukung yang relevan untuk pengajuan cuti Anda.'
                : 'Untuk izin, lampirkan bukti persetujuan atasan (mis. screenshot WhatsApp). Untuk sakit lebih dari 1 hari, lampirkan surat keterangan dokter.'}
            </p>
          </Step>
        </div>

        <Card className='gap-4 px-6 py-6 lg:sticky lg:top-20'>
          <h3 className='text-base font-semibold'>Ringkasan</h3>
          <div className='space-y-3.5'>
            <SummaryRow label='Jenis' value={kind === 'LEAVE' ? 'Cuti' : 'Izin'} />
            <SummaryRow label='Kategori' value={selectedType?.name ?? '—'} />
            <SummaryRow label='Tanggal' value={dateSummary} />
            <SummaryRow label='Total' value={`${formatDays(totalDays)} hari`} />
            <SummaryRow label='Disetujui oleh' value={managerName || '—'} />
          </div>
          {shownQuota && (
            <div className='space-y-2 border-t pt-4'>
              <div className='flex items-baseline justify-between text-sm'>
                <span className='text-muted-foreground'>Sisa cuti setelah pengajuan</span>
                <span className={cn('font-semibold tabular-nums', overQuota && 'text-destructive')}>
                  {formatDays(remainingAfter)} / {formatDays(remainingNow)} hari
                </span>
              </div>
              <div className='bg-muted h-2 overflow-hidden rounded-full'>
                <div
                  className={cn('h-full rounded-full', overQuota ? 'bg-destructive' : 'bg-primary')}
                  style={{ width: `${remainingNow > 0 ? Math.max(0, Math.min(100, (remainingAfter / remainingNow) * 100)) : 0}%` }}
                />
              </div>
              <p className={cn('text-xs', overQuota ? 'text-destructive' : 'text-muted-foreground')}>
                {!selectedType
                  ? 'Pilih kategori untuk menghitung sisa kuota.'
                  : overQuota
                    ? `Melebihi sisa kuota ${quota?.leave_type_name}.`
                    : quota
                      ? `Memotong kuota ${quota.leave_type_name}${quota.pending_days > 0 ? ` · ${formatDays(quota.pending_days)} hari masih menunggu persetujuan` : ''}.`
                      : 'Kategori ini tidak memotong kuota cuti tahunan.'}
              </p>
            </div>
          )}
          <Button type='submit' size='lg' className='w-full' disabled={submitting || !!missing}>
            {submitting ? 'Mengirim...' : 'Kirim Pengajuan'}
          </Button>
          {missing && <p className='text-muted-foreground -mt-1 text-center text-xs'>Lengkapi {missing} untuk mengirim.</p>}
          <Button type='button' variant='ghost' className='w-full' onClick={() => router.push(redirectTo)} disabled={submitting}>
            Batal
          </Button>
        </Card>
      </form>
    </div>
  );
}
