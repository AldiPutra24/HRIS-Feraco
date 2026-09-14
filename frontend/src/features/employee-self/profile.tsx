'use client';

import { useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Icons } from '@/components/icons';
import { useRouter } from 'next/navigation';
import { deleteMyPhoto, uploadMyPhoto } from '@/lib/employee-self';
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

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className='flex justify-between gap-4 py-2'>
      <span className='text-muted-foreground text-sm'>{label}</span>
      <span className='text-right text-sm font-medium break-all'>{value || '-'}</span>
    </div>
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
}

const EMPLOYMENT_VARIANT: Record<string, 'default' | 'secondary' | 'destructive'> = {
  ACTIVE: 'default',
  INACTIVE: 'secondary',
  TERMINATED: 'destructive'
};

export function EmployeeProfile() {
  const { employee, contracts, loading, error, refresh } = useMyEmployee();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [photoError, setPhotoError] = useState('');

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
        <p className='text-destructive'>{error}</p>
      </div>
    );
  }

  if (loading || !employee) {
    return (
      <div className='space-y-2 p-4 md:p-6'>
        <Skeleton className='h-8 w-64' />
        <Skeleton className='h-64 w-full' />
      </div>
    );
  }

  const current = contracts.find((c) => c.is_current) ?? null;

  return (
    <div className='flex flex-1 flex-col gap-4 p-4 md:p-6'>
      <div>
        <div className='flex items-center justify-between gap-4'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>Profile</h2>
            <p className='text-muted-foreground text-sm'>Data profil Anda.</p>
          </div>
          <Button variant='outline' onClick={() => router.push('/dashboard/settings/account')}>
            <Icons.account className='size-4' />
            Pengaturan Akun
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className='flex flex-col items-center gap-4 sm:flex-row'>
          <div className='relative shrink-0'>
            {employee.photo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={employee.photo_url}
                alt={employee.full_name}
                className='size-20 rounded-full border object-cover'
              />
            ) : (
              <div className='bg-muted text-muted-foreground flex size-20 items-center justify-center rounded-full border text-2xl font-semibold'>
                {employee.full_name.charAt(0).toUpperCase()}
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
              className='bg-primary text-primary-foreground absolute -right-1 -bottom-1 flex size-7 items-center justify-center rounded-full border-2 border-background transition-opacity hover:opacity-80 disabled:opacity-50'
              onClick={() => fileRef.current?.click()}
            >
              <Icons.upload className='size-3.5' />
            </button>
            {employee.photo_url && (
              <button
                type='button'
                disabled={busy}
                aria-label='Hapus foto profil'
                className='bg-destructive text-destructive-foreground absolute -top-1 -right-1 flex size-7 items-center justify-center rounded-full border-2 border-background transition-opacity hover:opacity-80 disabled:opacity-50'
                onClick={onDeletePhoto}
              >
                <Icons.trash className='size-3.5' />
              </button>
            )}
          </div>
          <div className='text-center sm:text-left'>
            <h3 className='text-lg font-semibold'>{employee.full_name}</h3>
            <p className='text-muted-foreground text-sm'>
              {employee.position_name || '-'} · {employee.department_name || '-'}
            </p>
            <div className='mt-2 flex flex-wrap items-center justify-center gap-2 sm:justify-start'>
              <Badge variant={EMPLOYMENT_VARIANT[employee.employment_status] ?? 'secondary'}>
                {employee.employment_status}
              </Badge>
              <span className='text-muted-foreground text-xs'>{employee.employee_id}</span>
            </div>
            {photoError && <p className='text-destructive mt-2 text-xs'>{photoError}</p>}
          </div>
        </CardContent>
      </Card>

      <div className='grid grid-cols-1 gap-4 lg:grid-cols-2'>
        <Card>
          <CardHeader>
            <CardTitle>Data Pribadi</CardTitle>
          </CardHeader>
          <CardContent className='divide-y'>
            <Row label='NIK' value={employee.nik} />
            <Row label='Tempat Lahir' value={employee.birth_place} />
            <Row label='Tanggal Lahir' value={fmtDate(employee.birth_date)} />
            <Row label='Jenis Kelamin' value={employee.gender_display} />
            <Row label='Agama' value={employee.religion_display} />
            <Row label='Status Pernikahan' value={employee.marital_status_display} />
            <Row label='Alamat' value={employee.address} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Kontak</CardTitle>
          </CardHeader>
          <CardContent className='divide-y'>
            <Row label='Nomor Telepon' value={employee.phone} />
            <Row label='Email Pribadi' value={employee.personal_email} />
            <Row label='Email Kantor' value={employee.company_email} />
            <Row label='Kontak Darurat' value={employee.emergency_contact_name} />
            <Row label='Nomor Kontak Darurat' value={employee.emergency_contact_phone} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Kepegawaian</CardTitle>
          </CardHeader>
          <CardContent className='divide-y'>
            <Row label='Employee ID' value={employee.employee_id} />
            <Row label='Department' value={employee.department_name} />
            <Row label='Position' value={employee.position_name} />
            <Row label='Reporting To' value={employee.manager_name} />
            <Row label='Join Date' value={fmtDate(employee.join_date)} />
            <Row label='Employment Status' value={employee.employment_status} />
            <Row label='Penempatan' value={employee.placement_display} />
            <Row label='Kontrak Aktif' value={current?.contract_type ?? ''} />
            {current?.end_date && <Row label='Kontrak Berakhir' value={fmtDate(current.end_date)} />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Bank & Pajak</CardTitle>
          </CardHeader>
          <CardContent className='divide-y'>
            <Row label='Nomor Rekening' value={employee.bank_account_number} />
            <Row label='Nama Rekening' value={employee.bank_account_name} />
            <Row label='NPWP' value={employee.npwp} />
            <Row label='BPJS Kesehatan' value={employee.bpjs_kesehatan} />
            <Row label='BPJS Ketenagakerjaan' value={employee.bpjs_ketenagakerjaan} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
