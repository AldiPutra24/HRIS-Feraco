'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';
import { deleteMyPhoto, uploadMyPhoto } from '@/lib/employee-self';
import { listMyChangeRequests, type ChangeRequest } from '@/lib/profile-changes';
import { ChangeRequestHistory, ChangeRequestSheet, ContactEditSheet } from './profile-edit';
import { useMyEmployee } from './use-my-employee';

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE = 5 * 1024 * 1024;

type IconName = keyof typeof Icons;

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
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

const EMPLOYMENT_TONE: Record<string, string> = {
  ACTIVE: 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/30 dark:text-emerald-300',
  INACTIVE: 'bg-slate-500/10 text-slate-600 ring-slate-500/30 dark:text-slate-300',
  TERMINATED: 'bg-red-500/10 text-red-700 ring-red-500/30 dark:text-red-300'
};

/** One labelled value; pending = a change request is waiting for HR. */
function Field({
  label,
  value,
  pending,
  wide
}: {
  label: string;
  value?: string | null;
  pending?: boolean;
  wide?: boolean;
}) {
  return (
    <div className={cn('min-w-0 space-y-1', wide && 'sm:col-span-2')}>
      <dt className='text-muted-foreground text-xs font-medium'>{label}</dt>
      <dd className={cn('text-sm font-medium break-words', !value && 'text-muted-foreground/70 font-normal')}>
        {value || 'Belum diisi'}
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

/** Section card: icon + title, an edit-mode pill, optional action. */
function Section({
  icon,
  title,
  mode,
  action,
  children
}: {
  icon: IconName;
  title: string;
  mode?: 'direct' | 'request' | 'hr';
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const Icon = Icons[icon];
  const pill = {
    direct: { text: 'Bisa diedit langsung', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' },
    request: { text: 'Perlu persetujuan HR', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-300' },
    hr: { text: 'Dikelola HR', cls: 'bg-muted text-muted-foreground' }
  }[mode ?? 'hr'];
  return (
    <Card className='gap-0 py-0'>
      <div className='flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3.5'>
        <div className='flex items-center gap-2.5'>
          <span className='bg-primary/10 text-primary flex size-8 items-center justify-center rounded-lg'>
            <Icon className='size-4' />
          </span>
          <div>
            <h3 className='text-sm font-semibold'>{title}</h3>
            <span className={cn('mt-0.5 inline-block rounded-full px-2 py-px text-[11px] font-medium', pill.cls)}>
              {pill.text}
            </span>
          </div>
        </div>
        {action}
      </div>
      <CardContent className='px-5 py-4'>
        <dl className='grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2'>{children}</dl>
      </CardContent>
    </Card>
  );
}

/** Small stat chip in the hero (icon + label + value). */
function HeroStat({ icon, label, value, hint }: { icon: IconName; label: string; value: string; hint?: string }) {
  const Icon = Icons[icon];
  return (
    <div className='bg-background/70 flex min-w-0 items-center gap-3 rounded-xl border px-3.5 py-2.5 backdrop-blur'>
      <span className='bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg'>
        <Icon className='size-4' />
      </span>
      <div className='min-w-0'>
        <p className='text-muted-foreground text-[11px] font-medium tracking-wide uppercase'>{label}</p>
        <p className='truncate text-sm font-semibold'>{value || '-'}</p>
        {hint && <p className='text-muted-foreground truncate text-xs'>{hint}</p>}
      </div>
    </div>
  );
}

export function EmployeeProfile() {
  const { employee, contracts, loading, error, refresh } = useMyEmployee();
  const router = useRouter();
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
      <div className='p-4 md:p-6'>
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
      <div className='flex flex-1 flex-col gap-5 p-4 md:p-6'>
        <Skeleton className='h-56 w-full rounded-2xl' />
        <div className='grid grid-cols-1 gap-4 lg:grid-cols-2'>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className='h-52 w-full' />
          ))}
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

  return (
    <div className='flex flex-1 flex-col gap-5 p-4 md:p-6'>
      {/* Hero */}
      <section className='from-primary/15 via-primary/5 to-background relative overflow-hidden rounded-2xl border bg-gradient-to-br p-5 md:p-6'>
        <div className='bg-primary/10 pointer-events-none absolute -top-20 -right-16 size-64 rounded-full blur-3xl' />
        <div className='relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between'>
          <div className='flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left'>
            {/* Avatar with change / remove controls */}
            <div className='group relative shrink-0'>
              {employee.photo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={employee.photo_url}
                  alt={employee.full_name}
                  className='ring-background size-24 rounded-full object-cover shadow-md ring-4'
                />
              ) : (
                <div className='bg-primary text-primary-foreground ring-background flex size-24 items-center justify-center rounded-full text-3xl font-semibold shadow-md ring-4'>
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
                className='bg-primary text-primary-foreground border-background absolute right-0 bottom-0 flex size-8 items-center justify-center rounded-full border-2 shadow transition-transform hover:scale-105 disabled:opacity-50'
                onClick={() => fileRef.current?.click()}
              >
                {busy ? <Icons.spinner className='size-3.5 animate-spin' /> : <Icons.upload className='size-3.5' />}
              </button>
              {employee.photo_url && (
                <button
                  type='button'
                  disabled={busy}
                  aria-label='Hapus foto profil'
                  title='Hapus foto'
                  className='bg-destructive border-background absolute top-0 right-0 flex size-7 items-center justify-center rounded-full border-2 text-white opacity-0 shadow transition-opacity group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-50'
                  onClick={onDeletePhoto}
                >
                  <Icons.trash className='size-3' />
                </button>
              )}
            </div>

            <div className='min-w-0'>
              <h2 className='text-2xl font-bold tracking-tight md:text-3xl'>{employee.full_name}</h2>
              <p className='text-muted-foreground mt-1 text-sm'>
                {employee.position_name || 'Posisi belum diatur'}
                {employee.department_name ? ` · ${employee.department_name}` : ''}
              </p>
              <div className='mt-2.5 flex flex-wrap items-center justify-center gap-2 sm:justify-start'>
                <span
                  className={cn(
                    'rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1',
                    EMPLOYMENT_TONE[employee.employment_status] ?? EMPLOYMENT_TONE.INACTIVE
                  )}
                >
                  {employee.employment_status}
                </span>
                <Badge variant='outline' className='font-mono text-xs'>
                  {employee.employee_id}
                </Badge>
                {employee.placement_display && (
                  <Badge variant='outline' className='text-xs'>
                    {employee.placement_display}
                  </Badge>
                )}
              </div>
              {photoError && <p className='text-destructive mt-2 text-xs'>{photoError}</p>}
            </div>
          </div>

          <div className='flex flex-wrap justify-center gap-2 lg:justify-end'>
            <Button onClick={() => setRequestOpen(true)}>
              <Icons.edit className='size-4' />
              Ajukan Perubahan Data
            </Button>
            <Button variant='outline' className='bg-background/70' onClick={() => router.push('/dashboard/settings/account')}>
              <Icons.lock className='size-4' />
              Pengaturan Akun
            </Button>
          </div>
        </div>

        <div className='relative mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3'>
          <HeroStat icon='calendar' label='Bergabung' value={fmtDate(employee.join_date)} hint={tenure(employee.join_date)} />
          <HeroStat
            icon='briefcase'
            label='Kontrak Aktif'
            value={contractValue}
            hint={current?.end_date ? `Berakhir ${fmtDate(current.end_date)}` : current ? 'Tanpa tanggal berakhir' : ''}
          />
          <HeroStat icon='user' label='Reporting To' value={employee.manager_name ?? ''} />
        </div>
      </section>

      {pendingCount > 0 && (
        <div className='flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200'>
          <Icons.clock className='size-4 shrink-0' />
          <span>
            <b>{pendingCount} pengajuan perubahan data</b> sedang menunggu persetujuan HR. Data akan diperbarui otomatis setelah
            disetujui.
          </span>
        </div>
      )}

      <div className='grid grid-cols-1 gap-4 xl:grid-cols-2'>
        <Section
          icon='user'
          title='Data Pribadi'
          mode='request'
          action={
            <Button size='sm' variant='outline' onClick={() => setRequestOpen(true)}>
              Ajukan Perubahan
            </Button>
          }
        >
          <Field label='Nama Lengkap' value={employee.full_name} pending={pending('full_name')} wide />
          <Field label='NIK' value={employee.nik} pending={pending('nik')} />
          <Field label='Jenis Kelamin' value={employee.gender_display} pending={pending('gender')} />
          <Field label='Tempat Lahir' value={employee.birth_place} pending={pending('birth_place')} />
          <Field label='Tanggal Lahir' value={fmtDate(employee.birth_date)} pending={pending('birth_date')} />
          <Field label='Agama' value={employee.religion_display} pending={pending('religion')} />
          <Field label='Status Pernikahan' value={employee.marital_status_display} pending={pending('marital_status')} />
        </Section>

        <Section
          icon='phone'
          title='Kontak & Alamat'
          mode='direct'
          action={
            <Button size='sm' variant='outline' onClick={() => setEditOpen(true)}>
              <Icons.edit className='size-3.5' />
              Edit
            </Button>
          }
        >
          <Field label='Alamat' value={employee.address} wide />
          <Field label='Nomor Telepon' value={employee.phone} />
          <Field label='Email Pribadi' value={employee.personal_email} />
          <Field label='Kontak Darurat' value={employee.emergency_contact_name} />
          <Field label='Nomor Kontak Darurat' value={employee.emergency_contact_phone} />
        </Section>

        <Section
          icon='wallet'
          title='Bank & Pajak'
          mode='request'
          action={
            <Button size='sm' variant='outline' onClick={() => setRequestOpen(true)}>
              Ajukan Perubahan
            </Button>
          }
        >
          <Field label='Nomor Rekening' value={employee.bank_account_number} pending={pending('bank_account_number')} />
          <Field label='Nama Pemilik Rekening' value={employee.bank_account_name} pending={pending('bank_account_name')} />
          <Field label='NPWP' value={employee.npwp} pending={pending('npwp')} />
          <Field label='BPJS Kesehatan' value={employee.bpjs_kesehatan} pending={pending('bpjs_kesehatan')} />
          <Field label='BPJS Ketenagakerjaan' value={employee.bpjs_ketenagakerjaan} pending={pending('bpjs_ketenagakerjaan')} />
        </Section>

        <Section icon='briefcase' title='Kepegawaian' mode='hr'>
          <Field label='Employee ID' value={employee.employee_id} />
          <Field label='Email Kantor' value={employee.company_email} />
          <Field label='Department' value={employee.department_name} />
          <Field label='Position' value={employee.position_name} />
          <Field label='Reporting To' value={employee.manager_name} />
          <Field label='Penempatan' value={employee.placement_display} />
          <Field label='Join Date' value={fmtDate(employee.join_date)} />
          <Field label='Employment Status' value={employee.employment_status} />
        </Section>
      </div>

      <ChangeRequestHistory items={requests} onChanged={loadRequests} />

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
