'use client';

import { useEffect, useState } from 'react';
import { notFound } from 'next/navigation';
import { toast } from 'react-toastify';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { applyJob, getPublicJob, type PublicJob } from '@/lib/recruitment';

function employmentLabel(v: string): string {
  return v.replace('_', ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export function PublicJobPage({ slug }: { slug: string }) {
  const [job, setJob] = useState<PublicJob | null>(null);
  const [notFoundState, setNotFoundState] = useState(false);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [done, setDone] = useState(false);
  const [form, setForm] = useState({ full_name: '', email: '', phone: '' });
  const [cv, setCv] = useState<File | null>(null);

  useEffect(() => {
    getPublicJob(slug)
      .then(setJob)
      .catch(() => setNotFoundState(true))
      .finally(() => setLoading(false));
  }, [slug]);

  if (notFoundState) notFound();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!job) return;
    if (!form.full_name.trim() || !form.email.trim()) {
      toast.error('Nama dan email wajib diisi.');
      return;
    }
    setApplying(true);
    try {
      await applyJob({
        job: job.id,
        full_name: form.full_name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        source: 'PORTAL',
        cv
      });
      setDone(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal mengirim lamaran.');
    } finally {
      setApplying(false);
    }
  }

  if (loading) {
    return (
      <div className='flex min-h-screen items-center justify-center'>
        <p className='text-muted-foreground'>Memuat...</p>
      </div>
    );
  }

  if (!job) return null;

  return (
    <main className='min-h-screen bg-[linear-gradient(135deg,#F7FBFD_0%,#EDF8FC_50%,#F5FAFC_100%)] py-10'>
      <div className='mx-auto w-full max-w-3xl px-4'>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src='/frc-recruitment.webp'
          alt='FeraCo Recruitment'
          className='mb-6 h-40 w-full rounded-2xl object-cover md:h-56'
        />
        <Card>
          <CardHeader>
            <div className='flex flex-wrap items-center gap-2'>
              <span className='text-muted-foreground text-sm'>{job.department_name || 'Umum'}</span>
              {job.position_name && (
                <span className='text-muted-foreground text-sm'>· {job.position_name}</span>
              )}
            </div>
            <CardTitle className='text-2xl font-bold tracking-tight'>{job.title}</CardTitle>
            <CardDescription>
              {employmentLabel(job.employment_type)}
              {job.location ? ` · ${job.location}` : ''}
              {' · '}
              {job.open_date} {job.close_date ? `– ${job.close_date}` : ''}
            </CardDescription>
          </CardHeader>
          <CardContent className='space-y-5'>
            {job.description && (
              <div>
                <h3 className='mb-1 text-sm font-semibold'>Deskripsi</h3>
                <p className='text-muted-foreground whitespace-pre-line text-sm'>{job.description}</p>
              </div>
            )}
            {job.requirements && (
              <div>
                <h3 className='mb-1 text-sm font-semibold'>Persyaratan</h3>
                <p className='text-muted-foreground whitespace-pre-line text-sm'>{job.requirements}</p>
              </div>
            )}

            <div className='border-border border-t pt-5'>
              {done ? (
                <p className='text-primary text-center text-sm font-medium'>
                  Lamaran terkirim. Terima kasih atas minat Anda!
                </p>
              ) : (
                <form onSubmit={submit} className='space-y-3'>
                  <h3 className='text-sm font-semibold'>Lamar Posisi Ini</h3>
                  <div>
                    <Label className='text-xs'>Nama Lengkap *</Label>
                    <Input
                      value={form.full_name}
                      onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                      placeholder='Nama Anda'
                    />
                  </div>
                  <div>
                    <Label className='text-xs'>Email *</Label>
                    <Input
                      type='email'
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      placeholder='email@contoh.com'
                    />
                  </div>
                  <div>
                    <Label className='text-xs'>Telepon</Label>
                    <Input
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                      placeholder='08xx'
                    />
                  </div>
                  <div>
                    <Label className='text-xs'>CV (PDF/DOC)</Label>
                    <Input
                      type='file'
                      accept='.pdf,.doc,.docx'
                      onChange={(e) => setCv(e.target.files?.[0] || null)}
                    />
                  </div>
                  <Button type='submit' disabled={applying}>
                    {applying ? 'Mengirim...' : 'Kirim Lamaran'}
                  </Button>
                </form>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
