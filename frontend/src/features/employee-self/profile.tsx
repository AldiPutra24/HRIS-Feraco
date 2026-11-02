'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';
import { deleteMyPhoto, uploadMyPhoto } from '@/lib/employee-self';
import type { Employee } from '@/lib/employees';
import { listMyChangeRequests, type ChangeRequest } from '@/lib/profile-changes';
import { ChangeRequestHistory, ChangeRequestSheet, ContactEditSheet } from './profile-edit';
import { useMyEmployee } from './use-my-employee';

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE = 5 * 1024 * 1024;

async function toSquare(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 512, 512);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  if (!blob) return file;
  return new File([blob], 'photo.jpg', { type: 'image/jpeg' });
}

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
}

/** "2 tahun 3 bulan" since `iso` (masa kerja). */
function tenure(iso: string | null): string {
  if (!iso) return '';
  const start = new Date(iso);
  if (isNaN(start.getTime())) return '';
  const now = new Date();
  let months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  if (now.getDate() < start.getDate()) months -= 1;
  if (months < 1) return 'kurang dari 1 bulan';
  const y = Math.floor(months / 12);
  const m = months % 12;
  return [y ? `${y} tahun` : '', m ? `${m} bulan` : ''].filter(Boolean).join(' ');
}

function initials(name: string): string {
  return name
    .replace(/\([^)]*\)/g, '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

const EMPLOYMENT: Record<string, { label: string; cls: string; dot: string }> = {
  ACTIVE: { label: 'Aktif', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300', dot: 'bg-emerald-600' },
  INACTIVE: { label: 'Nonaktif', cls: 'bg-muted text-muted-foreground', dot: 'bg-muted-foreground' },
  TERMINATED: { label: 'Berhenti', cls: 'bg-red-500/10 text-red-700 dark:text-red-300', dot: 'bg-red-600' }
};

type Mode = 'direct' | 'request' | 'hr';

const MODE: Record<Mode, { dot: string; legend: string; subtitle: string }> = {
  direct: { dot: 'bg-primary', legend: 'Bisa diedit langsung', subtitle: 'Bisa diedit langsung' },
  request: { dot: 'bg-orange-600', legend: 'Perlu persetujuan HR', subtitle: 'Perubahan perlu persetujuan HR' },
  hr: { dot: 'bg-muted-foreground/60', legend: 'Dikelola HR', subtitle: 'Dikelola HR · hubungi HR untuk perubahan' }
};

type SectionKey = 'pribadi' | 'kontak' | 'bank' | 'kepegawaian';

const SECTIONS: { key: SectionKey; title: string; mode: Mode }[] = [
  { key: 'pribadi', title: 'Data Pribadi', mode: 'request' },
  { key: 'kontak', title: 'Kontak & Alamat', mode: 'direct' },
  { key: 'bank', title: 'Bank & Pajak', mode: 'request' },
  { key: 'kepegawaian', title: 'Kepegawaian', mode: 'hr' }
];

/** Fields counted for "Kelengkapan profil" (what the employee/HR can fill in). */
function completenessFields(e: Employee): { label: string; section: SectionKey; filled: boolean }[] {
  const rows: [string, SectionKey, unknown][] = [
    ['Nama lengkap', 'pribadi', e.full_name],
    ['NIK', 'pribadi', e.nik],
    ['Jenis kelamin', 'pribadi', e.gender_display],
    ['Tempat lahir', 'pribadi', e.birth_place],
    ['Tanggal lahir', 'pribadi', e.birth_date],
    ['Agama', 'pribadi', e.religion_display],
    ['Status pernikahan', 'pribadi', e.marital_status_display],
    ['Alamat', 'kontak', e.address],
    ['Nomor telepon', 'kontak', e.phone],
    ['Email pribadi', 'kontak', e.personal_email],
    ['Kontak darurat', 'kontak', e.emergency_contact_name],
    ['Nomor kontak darurat', 'kontak', e.emergency_contact_phone],
    ['Nomor rekening', 'bank', e.bank_account_number],
    ['Nama pemilik rekening', 'bank', e.bank_account_name],
    ['NPWP', 'bank', e.npwp],
    ['BPJS Kesehatan', 'bank', e.bpjs_kesehatan],
    ['BPJS Ketenagakerjaan', 'bank', e.bpjs_ketenagakerjaan],
    ['Penempatan', 'kepegawaian', e.placement_display]
  ];
  return rows.map(([label, section, value]) => ({ label, section, filled: !!value }));
}

/** One labelled value; pending = a change request is waiting for HR. */
function Field({ label, value, pending, mono }: { label: string; value?: string | null; pending?: boolean; mono?: boolean }) {
  return (
    <div className='min-w-0 space-y-1'>
      <dt className='text-muted-foreground text-sm'>{label}</dt>
      <dd className={cn('break-words', mono && 'font-mono')}>
        {value ? (
          value
        ) : (
          <span className='inline-flex items-center gap-1.5 text-orange-700 dark:text-orange-300'>
            <Icons.alertCircle className='size-4' />
            Belum diisi
          </span>
        )}
      </dd>
      {pending && (
        <span className='inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300'>
          <Icons.clock className='size-3' />
          Menunggu persetujuan HR
        </span>
      )}
    </div>
  );
}

function Section({
  id,
  title,
  mode,
  action,
  children
}: {
  id: SectionKey;
  title: string;
  mode: Mode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card id={`profil-${id}`} className='scroll-mt-20 gap-0 py-0'>
      <div className='flex flex-wrap items-center justify-between gap-3 border-b px-6 py-4'>
        <div className='flex items-start gap-3'>
          <span className={cn('mt-2 size-2 shrink-0 rounded-full', MODE[mode].dot)} />
          <div>
            <h3 className='text-lg font-semibold'>{title}</h3>
            <p className='text-muted-foreground text-sm'>{MODE[mode].subtitle}</p>
          </div>
        </div>
        {action}
      </div>
      <dl className='grid grid-cols-1 gap-x-8 gap-y-5 px-6 py-5 sm:grid-cols-2 lg:grid-cols-3'>{children}</dl>
    </Card>
  );
}

export function EmployeeProfile() {
  const { employee, contracts, loading, error, refresh } = useMyEmployee();
  const router = useRouter();
  const pathname = usePathname();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [requests, setRequests] = useState<ChangeRequest[]>([]);

  const loadRequests = useCallback(() => {
    listMyChangeRequests()
      .then(setRequests)
      .catch(() => setRequests([]));
  }, []);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  // Fields with a request still waiting for HR (badge + cannot be re-requested).
  const pendingFields = useMemo(
    () => new Set(requests.filter((r) => r.status === 'PENDING').flatMap((r) => r.items.map((it) => it.field))),
    [requests]
  );
  const pendingCount = requests.filter((r) => r.status === 'PENDING').length;
  const pending = (field: string) => pendingFields.has(field);

  async function onPickFile(file: File) {
    setPhotoError('');
    if (!ALLOWED.includes(file.type)) {
      setPhotoError('Format harus JPG, PNG, atau WebP.');
      return;
    }
    if (file.size > MAX_SIZE) {
      setPhotoError('Ukuran maksimal 5MB.');
      return;
    }
    setBusy(true);
    try {
      const square = await toSquare(file);
      await uploadMyPhoto(square);
      await refresh();
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : 'Gagal mengunggah foto.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function onDeletePhoto() {
    if (!window.confirm('Hapus foto profil?')) return;
    setPhotoError('');
    setBusy(true);
    try {
      await deleteMyPhoto();
      await refresh();
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : 'Gagal menghapus foto.');
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div className='p-4 md:p-8'>
        <Card className='border-destructive/30'>
          <CardContent className='flex items-center gap-3 p-6'>
            <Icons.alertCircle className='text-destructive size-5' />
            <p className='text-destructive text-sm font-medium'>{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (loading || !employee) {
    return (
      <div className='flex flex-1 flex-col gap-5 p-4 md:p-8'>
        <Skeleton className='h-56 w-full rounded-2xl' />
        <div className='grid grid-cols-1 gap-4 lg:grid-cols-[1fr_380px]'>
          <Skeleton className='h-96 w-full' />
          <Skeleton className='h-72 w-full' />
        </div>
      </div>
    );
  }

  const current = contracts.find((c) => c.is_current) ?? null;
  const contractValue = current
    ? current.contract_type === 'PKWT' && current.pkwt_sequence
      ? `PKWT ke-${current.pkwt_sequence}`
      : current.contract_type
    : '';
  // Same page serves Employee and Management/GM profiles.
  const contractHref = pathname.startsWith('/dashboard/management') ? '/dashboard/management/contract' : '/dashboard/employee/contract';
  const status = EMPLOYMENT[employee.employment_status] ?? EMPLOYMENT.INACTIVE;
  const fields = completenessFields(employee);
  const missing = fields.filter((f) => !f.filled);
  const completeness = Math.round(((fields.length - missing.length) / fields.length) * 100);
  const sectionTitle = (key: SectionKey) => SECTIONS.find((s) => s.key === key)?.title ?? '';
  // Backend masks identity/bank numbers for non-HR viewers ("32******0007").
  const masked = [employee.nik, employee.bank_account_number, employee.npwp, employee.bpjs_kesehatan, employee.bpjs_ketenagakerjaan].some(
    (v) => v?.includes('*')
  );
  const goTo = (key: SectionKey) =>
    document.getElementById(`profil-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const requestButton = (
    <Button variant='outline' className='h-10' onClick={() => setRequestOpen(true)}>
      <Icons.edit className='size-4' />
      Ajukan perubahan
    </Button>
  );

  return (
    <div className='flex flex-1 flex-col gap-6 p-4 md:p-8'>
      {/* Header card */}
      <Card className='gap-0 overflow-hidden py-0'>
        <div className='flex flex-col gap-5 px-6 py-6 lg:flex-row lg:items-center lg:justify-between'>
          <div className='flex flex-col items-center gap-5 text-center sm:flex-row sm:text-left'>
            <div className='group relative shrink-0'>
              {employee.photo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={employee.photo_url} alt={employee.full_name} className='size-28 rounded-full object-cover' />
              ) : (
                <div className='bg-primary/10 text-primary flex size-28 items-center justify-center rounded-full text-4xl font-semibold'>
                  {initials(employee.full_name)}
                </div>
              )}
              <input
                ref={fileRef}
                type='file'
                accept='image/jpeg,image/png,image/webp'
                className='hidden'
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onPickFile(f);
                }}
              />
              <button
                type='button'
                disabled={busy}
                aria-label={employee.photo_url ? 'Ganti foto profil' : 'Unggah foto profil'}
                title={employee.photo_url ? 'Ganti foto' : 'Unggah foto'}
                className='bg-foreground text-background border-card absolute right-0 bottom-0 flex size-10 items-center justify-center rounded-full border-4 transition-transform hover:scale-105 disabled:opacity-50'
                onClick={() => fileRef.current?.click()}
              >
                {busy ? <Icons.spinner className='size-4 animate-spin' /> : <Icons.camera className='size-4' />}
              </button>
              {employee.photo_url && (
                <button
                  type='button'
                  disabled={busy}
                  aria-label='Hapus foto profil'
                  title='Hapus foto'
                  className='bg-destructive border-card absolute top-0 right-0 flex size-8 items-center justify-center rounded-full border-2 text-white opacity-0 shadow transition-opacity group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-50'
                  onClick={onDeletePhoto}
                >
                  <Icons.trash className='size-3.5' />
                </button>
              )}
            </div>

            <div className='min-w-0'>
              <h2 className='text-3xl font-bold tracking-tight'>{employee.full_name}</h2>
              <p className='text-muted-foreground mt-1'>
                {employee.position_name || 'Posisi belum diatur'}
                {employee.department_name ? ` · ${employee.department_name}` : ''}
              </p>
              <div className='mt-3 flex flex-wrap items-center justify-center gap-2 sm:justify-start'>
                <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-medium', status.cls)}>
                  <span className={cn('size-1.5 rounded-full', status.dot)} />
                  {status.label}
                </span>
                <span className='bg-muted rounded-md px-2.5 py-1 font-mono text-sm'>{employee.employee_id}</span>
              </div>
              {photoError && <p className='text-destructive mt-2 text-xs'>{photoError}</p>}
            </div>
          </div>

          <div className='flex flex-wrap justify-center gap-2 lg:justify-end'>
            <Button variant='outline' className='h-11 px-4' onClick={() => router.push('/dashboard/settings/account')}>
              <Icons.lock className='size-4' />
              Pengaturan Akun
            </Button>
            <Button className='h-11 px-4' onClick={() => setRequestOpen(true)}>
              <Icons.edit className='size-4' />
              Ajukan Perubahan Data
            </Button>
          </div>
        </div>

        <div className='grid grid-cols-1 divide-y border-t sm:grid-cols-3 sm:divide-x sm:divide-y-0'>
          <div className='px-6 py-4'>
            <p className='text-muted-foreground text-sm'>Bergabung</p>
            <p className='mt-1 font-semibold'>{fmtDate(employee.join_date) || '—'}</p>
            {employee.join_date && <p className='text-muted-foreground text-sm'>{tenure(employee.join_date)} masa kerja</p>}
          </div>
          <div className='px-6 py-4'>
            <p className='text-muted-foreground text-sm'>Kontrak aktif</p>
            {current ? (
              <>
                <p className='mt-1 font-semibold'>{contractValue}</p>
                <p className='text-muted-foreground text-sm'>
                  {current.end_date ? `Berakhir ${fmtDate(current.end_date)}` : 'Tanpa tanggal berakhir'}
                </p>
              </>
            ) : (
              <>
                <p className='mt-1 font-semibold text-orange-700 dark:text-orange-300'>Tidak ada kontrak aktif</p>
                <Link href={contractHref} className='text-primary text-sm font-medium hover:underline'>
                  Lihat riwayat kontrak →
                </Link>
              </>
            )}
          </div>
          <div className='px-6 py-4'>
            <p className='text-muted-foreground text-sm'>Atasan langsung</p>
            <p className='mt-1 font-semibold'>{employee.manager_name || '—'}</p>
            {employee.manager_name && <p className='text-muted-foreground text-sm'>Menyetujui izin &amp; cuti</p>}
          </div>
        </div>
      </Card>

      {pendingCount > 0 && (
        <div className='flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200'>
          <Icons.clock className='size-4 shrink-0' />
          <span>
            <b>{pendingCount} pengajuan perubahan data</b> sedang menunggu persetujuan HR. Data akan diperbarui otomatis setelah
            disetujui.
          </span>
        </div>
      )}

      <div className='grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]'>
        <div className='flex min-w-0 flex-col gap-5'>
          <div className='text-muted-foreground flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-sm'>
            <div className='flex flex-wrap gap-x-5 gap-y-1'>
              {(Object.keys(MODE) as Mode[]).map((m) => (
                <span key={m} className='flex items-center gap-1.5'>
                  <span className={cn('size-2 rounded-full', MODE[m].dot)} />
                  {MODE[m].legend}
                </span>
              ))}
            </div>
            {masked && (
              <span className='flex items-center gap-1.5'>
                <Icons.lock className='size-4' />
                Nomor identitas &amp; rekening ditampilkan sebagian
              </span>
            )}
          </div>

          <Section id='pribadi' title='Data Pribadi' mode='request' action={requestButton}>
            <Field label='Nama lengkap' value={employee.full_name} pending={pending('full_name')} />
            <Field label='NIK' value={employee.nik} pending={pending('nik')} mono />
            <Field label='Jenis kelamin' value={employee.gender_display} pending={pending('gender')} />
            <Field label='Tempat lahir' value={employee.birth_place} pending={pending('birth_place')} />
            <Field label='Tanggal lahir' value={fmtDate(employee.birth_date)} pending={pending('birth_date')} />
            <Field label='Agama' value={employee.religion_display} pending={pending('religion')} />
            <Field label='Status pernikahan' value={employee.marital_status_display} pending={pending('marital_status')} />
          </Section>

          <Section
            id='kontak'
            title='Kontak & Alamat'
            mode='direct'
            action={
              <Button variant='outline' className='h-10' onClick={() => setEditOpen(true)}>
                <Icons.edit className='size-4' />
                Edit
              </Button>
            }
          >
            <Field label='Alamat' value={employee.address} />
            <Field label='Nomor telepon' value={employee.phone} mono />
            <Field label='Email pribadi' value={employee.personal_email} />
            <Field label='Kontak darurat' value={employee.emergency_contact_name} />
            <Field label='Nomor kontak darurat' value={employee.emergency_contact_phone} mono />
          </Section>

          <Section id='bank' title='Bank & Pajak' mode='request' action={requestButton}>
            <Field label='Nomor rekening' value={employee.bank_account_number} pending={pending('bank_account_number')} mono />
            <Field label='Nama pemilik rekening' value={employee.bank_account_name} pending={pending('bank_account_name')} />
            <Field label='NPWP' value={employee.npwp} pending={pending('npwp')} mono />
            <Field label='BPJS Kesehatan' value={employee.bpjs_kesehatan} pending={pending('bpjs_kesehatan')} mono />
            <Field
              label='BPJS Ketenagakerjaan'
              value={employee.bpjs_ketenagakerjaan}
              pending={pending('bpjs_ketenagakerjaan')}
              mono
            />
          </Section>

          <Section id='kepegawaian' title='Kepegawaian' mode='hr'>
            <Field label='Employee ID' value={employee.employee_id} mono />
            <Field label='Email kantor' value={employee.company_email} />
            <Field label='Department' value={employee.department_name} />
            <Field label='Position' value={employee.position_name} />
            <Field label='Reporting to' value={employee.manager_name} />
            <Field label='Penempatan' value={employee.placement_display} />
            <Field label='Join date' value={fmtDate(employee.join_date)} />
            <Field label='Employment status' value={status.label} />
          </Section>

          <ChangeRequestHistory items={requests} onChanged={loadRequests} />
        </div>

        <div className='flex min-w-0 flex-col gap-5 lg:sticky lg:top-20'>
          <Card className='gap-4 px-6 py-6'>
            <div className='flex items-baseline justify-between gap-2'>
              <h3 className='text-lg font-semibold'>Kelengkapan profil</h3>
              <span className='text-3xl font-semibold tabular-nums'>{completeness}%</span>
            </div>
            <div className='bg-muted h-2 overflow-hidden rounded-full'>
              <div className='bg-primary h-full rounded-full' style={{ width: `${completeness}%` }} />
            </div>
            {missing.length === 0 ? (
              <p className='text-muted-foreground flex items-center gap-2 text-sm'>
                <Icons.circleCheck className='text-primary size-4' />
                Semua data sudah lengkap.
              </p>
            ) : (
              <>
                <p className='text-muted-foreground text-sm'>{missing.length} data belum diisi:</p>
                <ul className='space-y-1.5'>
                  {missing.map((f) => (
                    <li key={f.label}>
                      <button
                        type='button'
                        onClick={() => goTo(f.section)}
                        className='bg-muted/40 hover:bg-muted flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors'
                      >
                        <span className='size-1.5 shrink-0 rounded-full bg-orange-600' />
                        <span className='flex-1 font-medium'>{f.label}</span>
                        <span className='text-muted-foreground text-xs'>{sectionTitle(f.section)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>

          <Card className='gap-1 px-4 py-4'>
            {SECTIONS.map((s) => (
              <button
                key={s.key}
                type='button'
                onClick={() => goTo(s.key)}
                className='hover:bg-muted flex items-center gap-3 rounded-lg px-2 py-2.5 text-left font-medium'
              >
                <span className={cn('size-2 shrink-0 rounded-full', MODE[s.mode].dot)} />
                <span className='flex-1'>{s.title}</span>
                <Icons.chevronRight className='text-muted-foreground size-4' />
              </button>
            ))}
          </Card>
        </div>
      </div>

      <ContactEditSheet employee={employee} open={editOpen} onOpenChange={setEditOpen} onSaved={refresh} />
      <ChangeRequestSheet
        employee={employee}
        pendingFields={pendingFields}
        open={requestOpen}
        onOpenChange={setRequestOpen}
        onSubmitted={loadRequests}
      />
    </div>
  );
}
