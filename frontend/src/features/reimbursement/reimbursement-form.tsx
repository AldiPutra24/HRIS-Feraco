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
  createReimbursement,
  listReimbursementCategories,
  submitReimbursement,
  uploadReimbursementAttachment,
  type ReimbursementCategory
} from '@/lib/reimbursements';

export function ReimbursementForm({ redirectTo = '/dashboard/employee/reimbursement' }: { redirectTo?: string }) {
  const router = useRouter();
  const [categories, setCategories] = useState<ReimbursementCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    category: '',
    transaction_date: '',
    amount: '',
    description: ''
  });
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const c = await listReimbursementCategories();
    setCategories(c);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const selected = categories.find((c) => c.id === Number(form.category));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.category || !form.transaction_date) {
      toast.error('Lengkapi kategori dan tanggal transaksi.');
      return;
    }
    const amount = Number(form.amount);
    if (!amount || amount <= 0) {
      toast.error('Jumlah harus lebih dari 0.');
      return;
    }
    if (selected?.requires_attachment && !file) {
      toast.error('Lampiran wajib untuk kategori ini.');
      return;
    }
    setSaving(true);
    try {
      const created = await createReimbursement({
        category: Number(form.category),
        transaction_date: form.transaction_date,
        amount,
        description: form.description
      });
      if (file) await uploadReimbursementAttachment(created.id, file);
      await submitReimbursement(created.id);
      toast.success('Pengajuan terkirim.');
      router.push(redirectTo);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal mengirim pengajuan.');
    } finally {
      setSaving(false);
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
        <h2 className='text-2xl font-bold tracking-tight'>Ajukan Reimbursement</h2>
        <p className='text-muted-foreground text-sm'>Isi formulir untuk mengajukan klaim reimbursement.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Formulir Pengajuan</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className='grid grid-cols-1 gap-3 md:grid-cols-4'>
            <div>
              <Label className='text-xs'>Kategori</Label>
              <select
                className='border-input h-9 w-full rounded-lg border bg-transparent px-2.5 text-sm'
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              >
                <option value=''>Pilih kategori</option>
                {categories
                  .filter((c) => c.is_active)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <Label className='text-xs'>Tanggal Transaksi</Label>
              <Input
                type='date'
                value={form.transaction_date}
                onChange={(e) => setForm((f) => ({ ...f, transaction_date: e.target.value }))}
              />
            </div>
            <div>
              <Label className='text-xs'>Jumlah (IDR)</Label>
              <Input
                type='number'
                min='1'
                step='0.01'
                placeholder='50000'
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              />
            </div>
            <div>
              <Label className='text-xs'>Lampiran {selected?.requires_attachment ? '(wajib)' : '(opsional)'}</Label>
              <input
                type='file'
                className='mt-1 block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground hover:file:bg-primary/80'
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </div>
            <div className='md:col-span-4'>
              <Label className='text-xs'>Deskripsi</Label>
              <Input
                placeholder='Deskripsi klaim'
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            <div className='flex items-center gap-2 md:col-span-4'>
              <Button type='submit' disabled={saving}>
                {saving ? 'Mengirim...' : 'Kirim Pengajuan'}
              </Button>
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
