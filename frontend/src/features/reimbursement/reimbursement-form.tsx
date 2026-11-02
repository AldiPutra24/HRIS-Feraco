'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'react-toastify';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';
import {
  createReimbursement,
  listReimbursementCategories,
  REIMBURSEMENT_PROJECTS,
  REIMBURSEMENT_TEMPLATE_URL,
  submitReimbursement,
  uploadReimbursementAttachment,
  type ReimbursementCategory
} from '@/lib/reimbursements';

// Same rules as the backend: PDF or image (JPG/PNG/WEBP), max 5 MB.
const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
const ATTACHMENT_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.webp'];
const ATTACHMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

const SELECT_CLASS =
  'border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-11 w-full rounded-lg border px-3 text-sm outline-none focus-visible:ring-3';

/** Error message for an invalid attachment, or null when it is acceptable. */
function attachmentError(f: File): string | null {
  const name = f.name.toLowerCase();
  if (!ATTACHMENT_EXTENSIONS.some((ext) => name.endsWith(ext)) || (f.type && !ATTACHMENT_TYPES.includes(f.type))) {
    return 'Bukti Payment/Tagihan/Invoice harus berupa file PDF atau gambar (JPG, PNG, WEBP).';
  }
  if (f.size > ATTACHMENT_MAX_BYTES) return 'Ukuran Bukti Payment/Tagihan/Invoice maksimal 5 MB.';
  return null;
}

function rupiah(n: number): string {
  return `Rp ${Math.round(n).toLocaleString('id-ID')}`;
}

function Step({ n, title, extra, children }: { n: number; title: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <Card className='gap-5 px-6 py-6'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div className='flex flex-wrap items-center gap-3'>
          <span className='bg-foreground text-background flex size-8 items-center justify-center rounded-lg text-sm font-semibold'>
            {n}
          </span>
          <h3 className='text-lg font-semibold'>{title}</h3>
        </div>
        {extra}
      </div>
      {children}
    </Card>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className='flex items-start justify-between gap-3 text-sm'>
      <span className='text-muted-foreground shrink-0'>{label}</span>
      <span className='min-w-0 truncate text-right font-medium' title={value}>
        {value}
      </span>
    </div>
  );
}

export function ReimbursementForm({ redirectTo = '/dashboard/employee/reimbursement' }: { redirectTo?: string }) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [categories, setCategories] = useState<ReimbursementCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    category: '',
    project_category: '',
    project_category_other: '',
    transaction_date: '',
    amount: '',
    description: '',
    bank_name: '',
    bank_account_name: '',
    bank_account_number: '',
    contact_email: ''
  });
  // Bukti Payment/Tagihan/Invoice: upload a file OR give a link (one of).
  const [evidenceMode, setEvidenceMode] = useState<'file' | 'link'>('file');
  const [file, setFile] = useState<File | null>(null);
  const [link, setLink] = useState('');
  const [dragOver, setDragOver] = useState(false);
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

  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  function pickFile(picked: File | null) {
    const error = picked ? attachmentError(picked) : null;
    if (error) {
      toast.error(error);
      if (fileInput.current) fileInput.current.value = '';
      setFile(null);
      return;
    }
    setFile(picked);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.category || !form.transaction_date) {
      toast.error('Lengkapi kategori dan tanggal transaksi.');
      return;
    }
    if (!form.project_category) {
      toast.error('Pilih kategori project.');
      return;
    }
    if (form.project_category === 'OTHER' && !form.project_category_other.trim()) {
      toast.error('Isi detail kategori project (OTHER).');
      return;
    }
    const amount = Number(form.amount);
    if (!amount || amount <= 0) {
      toast.error('Jumlah harus lebih dari 0.');
      return;
    }
    if (!form.bank_name.trim() || !form.bank_account_name.trim() || !form.bank_account_number.trim()) {
      toast.error('Lengkapi Nama Bank, Nama Pemilik Rekening, dan Nomor Rekening.');
      return;
    }
    if (!/^[\d\s-]{5,40}$/.test(form.bank_account_number.trim())) {
      toast.error('Nomor rekening hanya boleh angka.');
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(form.contact_email.trim())) {
      toast.error('Email aktif wajib diisi dengan format yang benar.');
      return;
    }
    if (!form.description.trim()) {
      toast.error('Deskripsi wajib diisi.');
      return;
    }
    if (evidenceMode === 'link') {
      if (!/^https?:\/\/\S+$/i.test(link.trim())) {
        toast.error('Link Bukti Payment/Tagihan/Invoice wajib diisi dan diawali http:// atau https://.');
        return;
      }
    } else {
      if (!file) {
        toast.error('Bukti Payment/Tagihan/Invoice wajib diunggah.');
        return;
      }
      const fileError = attachmentError(file);
      if (fileError) {
        toast.error(fileError);
        return;
      }
    }
    setSaving(true);
    try {
      const created = await createReimbursement({
        category: Number(form.category),
        project_category: form.project_category,
        project_category_other: form.project_category_other,
        transaction_date: form.transaction_date,
        amount,
        description: form.description.trim(),
        bank_name: form.bank_name.trim(),
        bank_account_name: form.bank_account_name.trim(),
        bank_account_number: form.bank_account_number.trim(),
        contact_email: form.contact_email.trim(),
        ...(evidenceMode === 'link' ? { attachment_link: link.trim() } : {})
      });
      if (evidenceMode === 'file' && file) await uploadReimbursementAttachment(created.id, file);
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
      <div className='space-y-2 p-4 md:p-8'>
        <Skeleton className='h-8 w-64' />
        <Skeleton className='h-40 w-full' />
      </div>
    );
  }

  const amount = Number(form.amount) || 0;
  const categoryName = categories.find((c) => String(c.id) === form.category)?.name;
  const projectName =
    form.project_category === 'OTHER'
      ? form.project_category_other.trim() || 'Other'
      : REIMBURSEMENT_PROJECTS.find((p) => p.value === form.project_category)?.label;
  const evidenceDone = evidenceMode === 'file' ? !!file : link.trim() !== '';
  const bankDone = !!(form.bank_name.trim() && form.bank_account_number.trim() && form.bank_account_name.trim());
  const checklist: [string, boolean][] = [
    ['jumlah', amount > 0],
    ['kategori', !!form.category],
    ['project', !!form.project_category && (form.project_category !== 'OTHER' || !!form.project_category_other.trim())],
    ['tanggal', !!form.transaction_date],
    ['deskripsi', !!form.description.trim()],
    ['bukti', evidenceDone],
    ['rekening', bankDone],
    ['email', !!form.contact_email.trim()]
  ];
  const done = checklist.filter(([, ok]) => ok).length;
  const missing = checklist.filter(([, ok]) => !ok).map(([label]) => label);
  const accountTail = form.bank_account_number.trim().slice(-4);

  return (
    <form onSubmit={submit} className='flex flex-1 flex-col gap-6 p-4 md:p-8'>
      <div>
        <Link href={redirectTo} className='text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm'>
          <Icons.arrowLeft className='size-4' />
          Kembali ke Reimbursement
        </Link>
        <h2 className='mt-3 text-3xl font-bold tracking-tight'>Ajukan Reimbursement</h2>
        <p className='text-muted-foreground mt-1'>Isi detail klaim. Semua kolom wajib diisi.</p>
      </div>

      <div className='grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]'>
        <div className='flex min-w-0 flex-col gap-6'>
          <Step n={1} title='Detail transaksi'>
            <div className='space-y-2'>
              <Label htmlFor='rb-amount'>Jumlah klaim</Label>
              <div className='border-input focus-within:border-ring focus-within:ring-ring/50 flex h-16 items-center gap-3 rounded-xl border px-4 focus-within:ring-3'>
                <span className='text-muted-foreground text-lg font-semibold'>Rp</span>
                <input
                  id='rb-amount'
                  inputMode='numeric'
                  placeholder='0'
                  value={form.amount ? Number(form.amount).toLocaleString('id-ID') : ''}
                  onChange={(e) => set('amount')(e.target.value.replace(/\D/g, '').replace(/^0+/, ''))}
                  className='placeholder:text-muted-foreground/60 w-full bg-transparent text-2xl font-semibold tabular-nums outline-none'
                />
              </div>
            </div>
            <div className='grid gap-4 md:grid-cols-3'>
              <div className='space-y-2'>
                <Label htmlFor='rb-category'>Kategori</Label>
                <select id='rb-category' className={SELECT_CLASS} value={form.category} onChange={(e) => set('category')(e.target.value)}>
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
              <div className='space-y-2'>
                <Label htmlFor='rb-project'>Project</Label>
                <select
                  id='rb-project'
                  className={SELECT_CLASS}
                  value={form.project_category}
                  onChange={(e) => setForm((f) => ({ ...f, project_category: e.target.value, project_category_other: '' }))}
                >
                  <option value=''>Pilih project</option>
                  {REIMBURSEMENT_PROJECTS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className='space-y-2'>
                <Label htmlFor='rb-date'>Tanggal transaksi</Label>
                <Input
                  id='rb-date'
                  type='date'
                  className='h-11'
                  value={form.transaction_date}
                  onChange={(e) => set('transaction_date')(e.target.value)}
                />
              </div>
            </div>
            {form.project_category === 'OTHER' && (
              <div className='space-y-2'>
                <Label htmlFor='rb-project-other'>Detail project</Label>
                <Input
                  id='rb-project-other'
                  className='h-11'
                  placeholder='Sebutkan project'
                  value={form.project_category_other}
                  onChange={(e) => set('project_category_other')(e.target.value)}
                />
              </div>
            )}
            <div className='space-y-2'>
              <Label htmlFor='rb-description'>Deskripsi</Label>
              <textarea
                id='rb-description'
                rows={4}
                className='border-input focus-visible:border-ring focus-visible:ring-ring/50 placeholder:text-muted-foreground w-full rounded-lg border bg-transparent px-3 py-2.5 text-sm outline-none focus-visible:ring-3'
                placeholder='Contoh: Transport ke kantor klien untuk presentasi'
                value={form.description}
                onChange={(e) => set('description')(e.target.value)}
              />
            </div>
          </Step>

          <Step
            n={2}
            title='Bukti pembayaran / invoice'
            extra={
              <div className='bg-muted flex rounded-lg p-1' role='group' aria-label='Jenis bukti'>
                {(
                  [
                    ['file', 'Unggah file'],
                    ['link', 'Tautan']
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type='button'
                    onClick={() => setEvidenceMode(mode)}
                    aria-pressed={evidenceMode === mode}
                    className={cn(
                      'rounded-md px-3 py-1.5 text-sm transition-colors',
                      evidenceMode === mode ? 'bg-background font-semibold shadow-sm' : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            }
          >
            {evidenceMode === 'file' ? (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  pickFile(e.dataTransfer.files?.[0] ?? null);
                }}
                className={cn(
                  'bg-muted/30 flex flex-wrap items-center gap-4 rounded-xl border border-dashed px-5 py-5 transition-colors',
                  dragOver && 'border-primary bg-primary/5'
                )}
              >
                <span className='bg-background flex size-12 shrink-0 items-center justify-center rounded-xl border'>
                  {file ? <Icons.page className='size-5' /> : <Icons.upload className='size-5' />}
                </span>
                <div className='min-w-0 flex-1'>
                  {file ? (
                    <>
                      <p className='truncate font-medium'>{file.name}</p>
                      <p className='text-muted-foreground text-sm'>{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                    </>
                  ) : (
                    <>
                      <p className='font-medium'>Klik untuk unggah atau seret file ke sini</p>
                      <p className='text-muted-foreground text-sm'>PDF, JPG, PNG, WEBP · maks. 5 MB</p>
                    </>
                  )}
                </div>
                <input
                  ref={fileInput}
                  type='file'
                  className='sr-only'
                  accept='application/pdf,.pdf,image/jpeg,.jpg,.jpeg,image/png,.png,image/webp,.webp'
                  onChange={(e) => pickFile(e.target.files?.[0] || null)}
                />
                {file ? (
                  <Button
                    type='button'
                    variant='outline'
                    onClick={() => {
                      setFile(null);
                      if (fileInput.current) fileInput.current.value = '';
                    }}
                  >
                    Hapus
                  </Button>
                ) : (
                  <Button type='button' variant='outline' onClick={() => fileInput.current?.click()}>
                    Pilih file
                  </Button>
                )}
              </div>
            ) : (
              <div className='space-y-2'>
                <Input
                  type='url'
                  className='h-11'
                  placeholder='https://drive.google.com/...'
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                />
                <p className='text-muted-foreground text-xs'>
                  Tempel link Google Drive/Sheets/Docs berisi bukti transaksi. Pastikan link dapat dibuka oleh HR.
                </p>
              </div>
            )}
            <div className='flex flex-wrap items-center gap-3 rounded-xl bg-blue-500/10 px-4 py-3.5 text-sm text-blue-900 dark:text-blue-200'>
              <span className='bg-background flex size-9 shrink-0 items-center justify-center rounded-lg'>
                <Icons.page className='size-4' />
              </span>
              <p className='min-w-0 flex-1'>
                Punya lebih dari 1 bukti transaksi? Gunakan template sesuai, lalu unggah sebagai satu PDF.
              </p>
              <a
                href={REIMBURSEMENT_TEMPLATE_URL}
                target='_blank'
                rel='noopener noreferrer'
                className='bg-background inline-flex items-center gap-1.5 rounded-lg px-3 py-2 font-semibold hover:underline'
              >
                <Icons.download className='size-4' />
                Unduh template
              </a>
            </div>
          </Step>

          <Step
            n={3}
            title='Rekening tujuan transfer'
            extra={
              <span className='mr-auto rounded-md bg-orange-500/10 px-2 py-1 text-xs font-medium text-orange-700 dark:text-orange-300'>
                Diutamakan Bank Mandiri
              </span>
            }
          >
            <div className='grid gap-4 md:grid-cols-3'>
              <div className='space-y-2'>
                <Label htmlFor='rb-bank'>Nama bank</Label>
                <Input id='rb-bank' className='h-11' placeholder='Mandiri' value={form.bank_name} onChange={(e) => set('bank_name')(e.target.value)} />
              </div>
              <div className='space-y-2'>
                <Label htmlFor='rb-account'>Nomor rekening</Label>
                <Input
                  id='rb-account'
                  className='h-11 font-mono'
                  inputMode='numeric'
                  placeholder='1234567890'
                  value={form.bank_account_number}
                  onChange={(e) => set('bank_account_number')(e.target.value)}
                />
              </div>
              <div className='space-y-2'>
                <Label htmlFor='rb-holder'>Nama pemilik rekening</Label>
                <Input
                  id='rb-holder'
                  className='h-11'
                  placeholder='Sesuai buku tabungan'
                  value={form.bank_account_name}
                  onChange={(e) => set('bank_account_name')(e.target.value)}
                />
              </div>
            </div>
            <div className='space-y-2 md:max-w-[calc((100%-2rem)/3)]'>
              <Label htmlFor='rb-email'>Email notifikasi</Label>
              <Input
                id='rb-email'
                type='email'
                className='h-11'
                placeholder='nama@email.com'
                value={form.contact_email}
                onChange={(e) => set('contact_email')(e.target.value)}
              />
              <p className='text-muted-foreground text-xs'>Konfirmasi transfer dikirim ke email ini. Gunakan email yang aktif.</p>
            </div>
          </Step>
        </div>

        <Card className='gap-0 overflow-hidden py-0 lg:sticky lg:top-20'>
          <div className='bg-muted/40 border-b px-6 py-5'>
            <p className='text-muted-foreground text-sm'>Total klaim</p>
            <p className='mt-1 text-3xl font-semibold tabular-nums'>{rupiah(amount)}</p>
          </div>
          <div className='space-y-3 px-6 py-5'>
            <SummaryRow label='Kategori' value={categoryName ?? '—'} />
            <SummaryRow label='Project' value={projectName ?? '—'} />
            <SummaryRow
              label='Tgl transaksi'
              value={
                form.transaction_date
                  ? new Date(`${form.transaction_date}T00:00:00`).toLocaleDateString('id-ID', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric'
                    })
                  : '—'
              }
            />
            <SummaryRow
              label='Bukti'
              value={evidenceMode === 'file' ? (file ? file.name : 'File · belum ada') : link.trim() ? 'Tautan' : 'Tautan · belum ada'}
            />
            <SummaryRow
              label='Transfer ke'
              value={form.bank_name.trim() ? `${form.bank_name.trim()}${accountTail ? ` ··${accountTail}` : ''}` : '—'}
            />
            <div className='bg-muted/40 rounded-lg border px-4 py-3'>
              <p className='text-sm font-medium'>
                Kelengkapan {done}/{checklist.length}
              </p>
              <div className='bg-muted mt-2 h-1.5 overflow-hidden rounded-full'>
                <div className='bg-primary h-full rounded-full transition-all' style={{ width: `${(done / checklist.length) * 100}%` }} />
              </div>
            </div>
            <Button type='submit' size='lg' className='h-12 w-full' disabled={saving || missing.length > 0}>
              {saving ? 'Mengirim...' : 'Kirim Pengajuan'}
            </Button>
            {missing.length > 0 && (
              <p className='text-muted-foreground text-center text-xs'>Lengkapi {missing.join(', ')}</p>
            )}
            <Button type='button' variant='ghost' className='w-full' onClick={() => router.push(redirectTo)}>
              Batal
            </Button>
          </div>
        </Card>
      </div>
    </form>
  );
}
