'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'react-toastify';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
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
import { MultiDateCalendar, formatIsoShort } from './multi-date-calendar';

export function LeaveForm({ redirectTo = '/dashboard/leave' }: { redirectTo?: string }) {
  const router = useRouter();
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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return; // prevent double-click/spam
    if (!form.leave_type || dates.length === 0 || !form.reason.trim()) {
      toast.error('Lengkapi kategori, tanggal (minimal 1 hari), dan alasan pengajuan.');
      return;
    }
    if (dates.some((d) => d < todayIso)) {
      toast.error('Tidak dapat mengajukan untuk tanggal sebelum hari ini.');
      return;
    }
    setSubmitting(true);
    try {
      const created = await createLeaveRequest({
        leave_type: Number(form.leave_type),
        kind,
        dates,
        half_days: halfDayAllowed ? halfDays.filter((d) => dates.includes(d)) : [],
        reason: form.reason
      });
      if (file) await uploadLeaveAttachment(created.id, file);
      toast.success('Pengajuan cuti berhasil dibuat');
      router.push(redirectTo);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal mengirim pengajuan.');
      setSubmitting(false); // re-enable so user can retry
    }
  }

  const selectedType = types.find((t) => t.id === Number(form.leave_type));
  // Full Day / Half Day applies to Cuti Tahunan.
  const halfDayAllowed = selectedType?.code === 'ANNUAL';
  const effectiveHalf = halfDayAllowed ? halfDays.filter((d) => dates.includes(d)) : [];
  const totalDays = dates.length - effectiveHalf.length * 0.5;
  const quotaTypeId = selectedType ? (selectedType.deducts_from ?? selectedType.id) : null;
  const quota = myBalances.find((b) => b.leave_type === quotaTypeId) ?? null;

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

  return (
    <div className='flex flex-1 flex-col gap-4 p-4 md:p-6'>
      <div>
        <h2 className='text-2xl font-bold tracking-tight'>Pengajuan Izin / Cuti</h2>
        <p className='text-muted-foreground text-sm'>Isi formulir untuk mengajukan izin atau cuti.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pengajuan Baru</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className='grid grid-cols-1 gap-3 md:grid-cols-4'>
            <div>
              <Label className='text-xs'>Jenis</Label>
              <select
                className='border-input h-9 w-full rounded-lg border bg-transparent px-2.5 text-sm'
                value={kind}
                onChange={(e) => {
                  const k = e.target.value as 'LEAVE' | 'PERMISSION';
                  setKind(k);
                  setForm((f) => ({ ...f, leave_type: '' }));
                }}
              >
                <option value='LEAVE'>Cuti</option>
                <option value='PERMISSION'>Izin</option>
              </select>
            </div>
            <div>
              <Label className='text-xs'>Atasan / Reporting To</Label>
              <Input
                readOnly
                value={me?.manager_name || ''}
                placeholder='Belum ditentukan'
                className='bg-muted/50'
              />
            </div>
            <div>
              <Label className='text-xs'>Kategori</Label>
              <select
                className='border-input h-9 w-full rounded-lg border bg-transparent px-2.5 text-sm'
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
            <div className='md:col-span-4'>
              <Label className='text-xs'>
                Tanggal Izin/Cuti <span className='text-destructive'>*</span>{' '}
                <span className='text-muted-foreground'>(klik tanggal untuk memilih; boleh tidak berurutan)</span>
              </Label>
              <div className='mt-1 flex flex-col gap-3 md:flex-row'>
                <MultiDateCalendar value={dates} onChange={setDates} minDate={todayIso} />
                <div className='flex-1 space-y-2'>
                  <p className='text-sm'>
                    Total: <span className='font-semibold'>{formatDays(totalDays)} hari</span>
                  </p>
                  {quota && (
                    <p className='text-muted-foreground text-xs'>
                      Sisa kuota {quota.leave_type_name} per hari ini:{' '}
                      <span className='text-foreground font-medium'>{formatDays(quota.remaining_days)} hari</span>
                      {quota.pending_days > 0 && ` (${formatDays(quota.pending_days)} hari menunggu persetujuan)`}
                    </p>
                  )}
                  {halfDayAllowed && dates.length > 0 && (
                    <p className='text-muted-foreground text-xs'>Klik Full/Half pada tiap tanggal (Full Day = 1, Half Day = 0,5).</p>
                  )}
                  {dates.length === 0 ? (
                    <p className='text-muted-foreground text-sm'>Belum ada tanggal dipilih.</p>
                  ) : (
                    <div className='flex flex-wrap gap-1.5'>
                      {dates.map((d) => (
                        <span
                          key={d}
                          className='bg-muted flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium'
                        >
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
                  )}
                </div>
              </div>
            </div>
            <div className='md:col-span-4'>
              <Label className='text-xs'>
                Berkas/Dokumen Pendukung <span className='text-muted-foreground'>(opsional sesuai jenis pengajuan)</span>
              </Label>
              <input
                type='file'
                className='mt-1 block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground hover:file:bg-primary/80'
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
              <p className='text-muted-foreground mt-1 text-xs'>
                Lampirkan dokumen pendukung yang relevan, seperti surat keterangan dokter untuk izin sakit lebih dari 1 hari, atau dokumen lainnya yang diperlukan. Untuk pengajuan izin, harap melampirkan bukti persetujuan dari User/Atasan (misalnya screenshot persetujuan melalui WhatsApp).
              </p>
            </div>
            <div className='md:col-span-4'>
              <Label className='text-xs'>
                Alasan Pengajuan <span className='text-destructive'>*</span>
              </Label>
              <Input
                required
                placeholder='Alasan pengajuan'
                value={form.reason}
                onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
              />
            </div>
            <div className='flex items-center gap-2 md:col-span-4'>
              <Button type='submit' disabled={submitting}>
                {submitting ? 'Mengirim...' : 'Kirim Pengajuan'}
              </Button>
              <Button type='button' variant='ghost' onClick={() => router.push(redirectTo)} disabled={submitting}>
                Batal
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
