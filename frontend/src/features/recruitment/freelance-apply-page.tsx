'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Icons } from '@/components/icons';
import {
  listFreelancePositions,
  submitFreelanceApplication,
  type FreelancePosition
} from '@/lib/freelance-apply';

export function FreelanceApplyPage() {
  const [positions, setPositions] = useState<FreelancePosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  const [form, setForm] = useState({
    full_name: '',
    phone: '',
    email: '',
    domicile: '',
    portfolio_url: '',
    expected_rate: '',
    notes: ''
  });
  const [cv, setCv] = useState<File | null>(null);

  useEffect(() => {
    listFreelancePositions()
      .then(setPositions)
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, []);

  // Close the position picker on outside click.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return positions;
    return positions.filter((p) => `${p.title} ${p.position_text}`.toLowerCase().includes(q));
  }, [positions, query]);

  const selectedLabels = useMemo(
    () => positions.filter((p) => selected.includes(p.id)).map((p) => p.title),
    [positions, selected]
  );

  function toggle(id: number) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.full_name.trim() || !form.phone.trim() || !form.email.trim()) {
      setError('Nama, No. WhatsApp/HP, dan Email wajib diisi.');
      return;
    }
    if (selected.length === 0) {
      setError('Pilih minimal satu posisi yang diminati.');
      return;
    }
    if (!cv) {
      setError('CV wajib diunggah (PDF/DOC/DOCX, maks 10MB).');
      return;
    }
    setSubmitting(true);
    try {
      await submitFreelanceApplication({
        ...form,
        position_ids: selected,
        cv
      });
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

  if (loadError) {
    return (
      <main className='flex min-h-screen items-center justify-center bg-[linear-gradient(135deg,#F7FBFD_0%,#EDF8FC_50%,#F5FAFC_100%)] px-4'>
        <p className='text-muted-foreground text-center text-sm'>
          Gagal memuat daftar posisi. Silakan refresh halaman.
        </p>
      </main>
    );
  }

  return (
    <main className='min-h-screen bg-[linear-gradient(135deg,#F7FBFD_0%,#EDF8FC_50%,#F5FAFC_100%)] py-8 md:py-12'>
      <div className='mx-auto w-full max-w-xl px-4'>
        {/* Branding */}
        <div className='mb-6 flex flex-col items-center gap-3 text-center'>
          <Image
            src='/logo.webp'
            alt='FERACO'
            width={120}
            height={40}
            className='h-10 w-auto'
            priority
          />
          <h1 className='text-2xl font-bold tracking-tight md:text-3xl'>
            Lamar Freelance di FERACO
          </h1>
          <p className='text-muted-foreground max-w-md text-sm'>
            Satu formulir untuk semua posisi freelance. Pilih posisi yang Anda minati,
            lengkapi data, unggah CV — tim kami akan menghubungi Anda.
          </p>
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
                  Terima kasih, {form.full_name.split(' ')[0] || 'kandidat'}! Lamaran Anda
                  sudah kami terima dan akan ditinjau oleh tim rekrutmen. Kandidat yang
                  sesuai profil akan dihubungi melalui WhatsApp/email.
                </p>
              </div>
            ) : (
              <form onSubmit={submit} className='space-y-4'>
                <div>
                  <Label className='text-xs'>Nama Lengkap *</Label>
                  <Input
                    required
                    value={form.full_name}
                    onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
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
                      value={form.phone}
                      onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                      placeholder='08xxxxxxxxxx'
                      className='mt-1'
                    />
                  </div>
                  <div>
                    <Label className='text-xs'>Email *</Label>
                    <Input
                      required
                      type='email'
                      value={form.email}
                      onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                      placeholder='nama@email.com'
                      className='mt-1'
                    />
                  </div>
                </div>
                <div>
                  <Label className='text-xs'>Domisili *</Label>
                  <Input
                    required
                    value={form.domicile}
                    onChange={(e) => setForm((f) => ({ ...f, domicile: e.target.value }))}
                    placeholder='Kota, mis. Jakarta Selatan'
                    className='mt-1'
                  />
                </div>

                {/* Searchable multi-select positions */}
                <div ref={pickerRef} className='relative'>
                  <Label className='text-xs'>Posisi yang Diminati * (boleh lebih dari satu)</Label>
                  <button
                    type='button'
                    onClick={() => setPickerOpen((v) => !v)}
                    className='border-input mt-1 flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-lg border bg-transparent px-2.5 py-1.5 text-left text-sm'
                  >
                    {selectedLabels.length === 0 ? (
                      <span className='text-muted-foreground'>Pilih posisi...</span>
                    ) : (
                      selectedLabels.map((l) => (
                        <span
                          key={l}
                          className='bg-primary/10 text-primary rounded-full px-2 py-0.5 text-xs font-medium'
                        >
                          {l}
                        </span>
                      ))
                    )}
                    <Icons.chevronDown className='ml-auto h-4 w-4 shrink-0 opacity-50' />
                  </button>
                  {pickerOpen && (
                    <div className='bg-background absolute z-20 mt-1 w-full rounded-lg border shadow-lg'>
                      <div className='p-2'>
                        <Input
                          autoFocus
                          placeholder='Cari posisi...'
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          className='h-8'
                        />
                      </div>
                      <div className='max-h-56 overflow-y-auto pb-1'>
                        {filtered.length === 0 && (
                          <p className='text-muted-foreground px-3 py-2 text-sm'>
                            Tidak ada posisi ditemukan.
                          </p>
                        )}
                        {filtered.map((p) => (
                          <button
                            key={p.id}
                            type='button'
                            onClick={() => toggle(p.id)}
                            className='hover:bg-muted flex w-full items-center justify-between px-3 py-2 text-left text-sm'
                          >
                            <span>{p.title}</span>
                            {selected.includes(p.id) && (
                              <Icons.check className='text-primary h-4 w-4' />
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div>
                  <Label className='text-xs'>CV * (PDF/DOC/DOCX, maks 10MB)</Label>
                  <input
                    type='file'
                    accept='.pdf,.doc,.docx'
                    onChange={(e) => setCv(e.target.files?.[0] || null)}
                    className='mt-1 block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground'
                  />
                </div>

                <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
                  <div>
                    <Label className='text-xs'>Portfolio URL (opsional)</Label>
                    <Input
                      type='url'
                      value={form.portfolio_url}
                      onChange={(e) => setForm((f) => ({ ...f, portfolio_url: e.target.value }))}
                      placeholder='https://...'
                      className='mt-1'
                    />
                  </div>
                  <div>
                    <Label className='text-xs'>Rate/Fee yang Diharapkan (opsional)</Label>
                    <Input
                      value={form.expected_rate}
                      onChange={(e) => setForm((f) => ({ ...f, expected_rate: e.target.value }))}
                      placeholder='mis. Rp 1.500.000/event'
                      className='mt-1'
                    />
                  </div>
                </div>
                <div>
                  <Label className='text-xs'>Catatan / Pengalaman (opsional)</Label>
                  <textarea
                    value={form.notes}
                    onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                    rows={3}
                    placeholder='Ceritakan singkat pengalaman Anda...'
                    className='border-input mt-1 w-full rounded-lg border bg-transparent px-3 py-2 text-sm'
                  />
                </div>

                {error && (
                  <p className='rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600'>{error}</p>
                )}

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
