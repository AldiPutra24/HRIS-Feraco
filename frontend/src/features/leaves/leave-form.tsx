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
  listLeaveTypes,
  uploadLeaveAttachment,
  type LeaveType
} from '@/lib/leaves';

export function LeaveForm({ redirectTo = '/dashboard/leave' }: { redirectTo?: string }) {
  const router = useRouter();
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    leave_type: '',
    start_date: '',
    end_date: '',
    reason: ''
  });
  const [file, setFile] = useState<File | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const t = await listLeaveTypes();
    setTypes(t);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.leave_type || !form.start_date || !form.end_date) {
      toast.error('Lengkapi jenis cuti, tanggal mulai, dan selesai.');
      return;
    }
    try {
      const created = await createLeaveRequest({
        leave_type: Number(form.leave_type),
        start_date: form.start_date,
        end_date: form.end_date,
        reason: form.reason
      });
      if (file) await uploadLeaveAttachment(created.id, file);
      toast.success('Pengajuan terkirim.');
      router.push(redirectTo);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal mengirim pengajuan.');
    }
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
              <Label className='text-xs'>Jenis Cuti</Label>
              <select
                className='border-input h-9 w-full rounded-lg border bg-transparent px-2.5 text-sm'
                value={form.leave_type}
                onChange={(e) => setForm((f) => ({ ...f, leave_type: e.target.value }))}
              >
                <option value=''>Pilih jenis</option>
                {types
                  .filter((t) => t.is_active)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <Label className='text-xs'>Tanggal Mulai</Label>
              <Input
                type='date'
                value={form.start_date}
                onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
              />
            </div>
            <div>
              <Label className='text-xs'>Tanggal Selesai</Label>
              <Input
                type='date'
                value={form.end_date}
                onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))}
              />
            </div>
            <div>
              <Label className='text-xs'>Lampiran</Label>
              <input
                type='file'
                className='mt-1 block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground hover:file:bg-primary/80'
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </div>
            <div className='md:col-span-4'>
              <Label className='text-xs'>Alasan</Label>
              <Input
                placeholder='Alasan pengajuan'
                value={form.reason}
                onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
              />
            </div>
            <div className='flex items-center gap-2 md:col-span-4'>
              <Button type='submit'>Kirim Pengajuan</Button>
              <Button type='button' variant='ghost' onClick={() => router.push(redirectTo)}>
                Batal
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
