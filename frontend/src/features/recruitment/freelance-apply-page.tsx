'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Icons } from '@/components/icons';

type PortalForm = {
  title: string;
  description: string;
  skills: { id: number; name: string; category: string | null }[];
};

export function FreelanceApplyPage({ slug }: { slug: string }) {
  const [form, setForm] = useState<PortalForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formState, setFormState] = useState({
    full_name: '',
    phone: '',
    email: '',
    domicile: '',
    portfolio_url: '',
    expected_rate: '',
    notes: ''
  });
  const [skillId, setSkillId] = useState<number | null>(null);
  const [cv, setCv] = useState<File | null>(null);

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL || ''}/api/recruitment/public/freelance/apply/${slug}/`)
      .then(async (res) => {
        if (!res.ok) throw new Error('not found');
        return res.json() as Promise<PortalForm>;
      })
      .then(setForm)
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [slug]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!formState.full_name.trim() || !formState.phone.trim() || !formState.email.trim() || !formState.domicile.trim()) {
      setError('Nama, No. WhatsApp/HP, Email, dan Domisili wajib diisi.');
      return;
    }
    if (skillId == null) {
      setError('Pilih satu posisi yang diminati.');
      return;
    }
    if (!cv && !formState.portfolio_url.trim()) {
      setError('Upload CV atau isi URL portfolio.');
      return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('full_name', formState.full_name);
      fd.append('phone', formState.phone);
      fd.append('email', formState.email);
      fd.append('domicile', formState.domicile);
      fd.append('skill_id', String(skillId));
      fd.append('portfolio_url', formState.portfolio_url);
      fd.append('expected_rate', formState.expected_rate);
      fd.append('notes', formState.notes);
      if (cv) fd.append('cv', cv);
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || ''}/api/recruitment/public/freelance/apply/${slug}/`,
        { method: 'POST', body: fd }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const d = data as Record<string, unknown>;
        let msg = typeof d.detail === 'string' ? d.detail : `Gagal mengirim lamaran (${res.status}).`;
        if (d.cv) msg = (d.cv as string[]).join(' ');
        throw new Error(msg);
      }
      setDone(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengirim lamaran.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <main className='flex min-h-screen items-center justify-center bg-[linear-gradient(135deg,#F7FBFD_0%,#EDF8FC_50%,#F5FAFC_100%)]'>
        <p className='text-muted-foreground'>Memuat...</p>
      </main>
    );
  }

  if (notFound || !form) {
    return (
      <main className='flex min-h-screen flex-col items-center justify-center gap-2 bg-[linear-gradient(135deg,#F7FBFD_0%,#EDF8FC_50%,#F5FAFC_100%)] px-4 text-center'>
        <Image src='/logo.webp' alt='FERACO' width={96} height={32} className='h-8 w-auto' />
        <p className='text-muted-foreground mt-2 text-sm'>
          Formulir tidak ditemukan atau sudah tidak aktif.
        </p>
      </main>
    );
  }

  return (
    <main className='min-h-screen bg-[linear-gradient(135deg,#F7FBFD_0%,#EDF8FC_50%,#F5FAFC_100%)] py-8 md:py-12'>
      <div className='mx-auto w-full max-w-xl px-4'>
        <div className='mb-6 flex flex-col items-center gap-3 text-center'>
          <Image src='/logo.webp' alt='FERACO' width={120} height={40} className='h-10 w-auto' priority />
          <h1 className='text-2xl font-bold tracking-tight md:text-3xl'>{form.title}</h1>
          {form.description && (
            <p className='text-muted-foreground max-w-md text-sm'>{form.description}</p>
          )}
        </div>

        <Card>
          <CardContent className='p-4 md:p-6'>
            {done ? (
              <div className='flex flex-col items-center gap-3 py-10 text-center'>
                <div className='flex h-14 w-14 items-center justify-center rounded-full bg-green-100'>
                  <Icons.check className='h-7 w-7 text-green-600' />
                </div>
                <h2 className='text-xl font-semibold'>Lamaran Terkirim!</h2>
                <p className='text-muted-foreground max-w-sm text-sm'>
                  Terima kasih, {formState.full_name.split(' ')[0] || 'kandidat'}! Lamaran Anda sudah kami
                  terima dan akan ditinjau oleh tim rekrutmen. Kandidat yang sesuai profil akan dihubungi
                  melalui WhatsApp/email.
                </p>
              </div>
            ) : (
              <form onSubmit={submit} className='space-y-4'>
                <div>
                  <Label className='text-xs'>Nama Lengkap *</Label>
                  <Input
                    required
                    value={formState.full_name}
                    onChange={(e) => setFormState((f) => ({ ...f, full_name: e.target.value }))}
                    placeholder='Nama sesuai KTP'
                    className='mt-1'
                  />
                </div>
                <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
                  <div>
                    <Label className='text-xs'>No. WhatsApp/HP *</Label>
                    <Input
                      required
                      type='tel'
                      inputMode='tel'
                      value={formState.phone}
                      onChange={(e) => setFormState((f) => ({ ...f, phone: e.target.value }))}
                      placeholder='08xxxxxxxxxx'
                      className='mt-1'
                    />
                  </div>
                  <div>
                    <Label className='text-xs'>Email *</Label>
                    <Input
                      required
                      type='email'
                      value={formState.email}
                      onChange={(e) => setFormState((f) => ({ ...f, email: e.target.value }))}
                      placeholder='nama@email.com'
                      className='mt-1'
                    />
                  </div>
                </div>
                <div>
                  <Label className='text-xs'>Domisili *</Label>
                  <Input
                    required
                    value={formState.domicile}
                    onChange={(e) => setFormState((f) => ({ ...f, domicile: e.target.value }))}
                    placeholder='Kota, mis. Jakarta Selatan'
                    className='mt-1'
                  />
                </div>

                {/* Position/skill — single select from HR-configured options */}
                <div>
                  <Label className='text-xs'>Posisi yang Diminati * (pilih satu)</Label>
                  <div className='mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2'>
                    {form.skills.map((s) => (
                      <button
                        key={s.id}
                        type='button'
                        onClick={() => setSkillId(s.id)}
                        className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition ${
                          skillId === s.id
                            ? 'border-primary bg-primary/10 text-primary font-medium'
                            : 'border-input hover:bg-muted'
                        }`}
                      >
                        <span>
                          {s.name}
                          {s.category && <span className='text-muted-foreground ml-1 text-xs'>· {s.category}</span>}
                        </span>
                        {skillId === s.id && <Icons.check className='h-4 w-4 shrink-0' />}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <Label className='text-xs'>CV (PDF/DOC/DOCX, maks 10MB)</Label>
                  <input
                    type='file'
                    accept='.pdf,.doc,.docx'
                    onChange={(e) => setCv(e.target.files?.[0] || null)}
                    className='mt-1 block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground'
                  />
                </div>
                <div>
                  <Label className='text-xs'>Portfolio URL (opsional jika sudah upload CV)</Label>
                  <Input
                    type='url'
                    value={formState.portfolio_url}
                    onChange={(e) => setFormState((f) => ({ ...f, portfolio_url: e.target.value }))}
                    placeholder='https://...'
                    className='mt-1'
                  />
                </div>
                <div>
                  <Label className='text-xs'>Rate/Fee yang Diharapkan (opsional)</Label>
                  <Input
                    value={formState.expected_rate}
                    onChange={(e) => setFormState((f) => ({ ...f, expected_rate: e.target.value }))}
                    placeholder='mis. Rp 1.500.000/event'
                    className='mt-1'
                  />
                </div>
                <div>
                  <Label className='text-xs'>Catatan / Pengalaman (opsional)</Label>
                  <textarea
                    value={formState.notes}
                    onChange={(e) => setFormState((f) => ({ ...f, notes: e.target.value }))}
                    rows={3}
                    placeholder='Ceritakan singkat pengalaman Anda...'
                    className='border-input mt-1 w-full rounded-lg border bg-transparent px-3 py-2 text-sm'
                  />
                </div>

                {error && <p className='rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600'>{error}</p>}

                <Button type='submit' className='w-full' disabled={submitting}>
                  {submitting ? 'Mengirim...' : 'Kirim Lamaran'}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        <p className='text-muted-foreground mt-6 text-center text-xs'>
          © {new Date().getFullYear()} FERACO · PT Fery Agung Corindotama
        </p>
      </div>
    </main>
  );
}
