'use client';

import { useEffect, useState } from 'react';
import { notFound } from 'next/navigation';
import { toast } from 'react-toastify';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { applyJob, getPublicJob, type PublicJob } from '@/lib/recruitment';

// Same rules as the backend: PDF or Word (DOC/DOCX), max 5 MB.
const CV_MAX_BYTES = 5 * 1024 * 1024;
const CV_EXTENSIONS = ['.pdf', '.doc', '.docx'];

/** Error message for an invalid CV, or null when it is acceptable. */
function cvError(f: File): string | null {
  const name = f.name.toLowerCase();
  if (!CV_EXTENSIONS.some((ext) => name.endsWith(ext))) return 'Format CV harus PDF atau DOC (Word).';
  if (f.size > CV_MAX_BYTES) return 'Ukuran CV maksimal 5 MB.';
  return null;
}

function employmentLabel(v: string): string {
  return v.replace('_', ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export function PublicJobPage({ slug }: { slug: string }) {
  const [job, setJob] = useState<PublicJob | null>(null);
  const [notFoundState, setNotFoundState] = useState(false);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [done, setDone] = useState(false);
  const [form, setForm] = useState({
    full_name: '',
    email: '',
    phone: '',
    domicile: '',
    portfolio_url: '',
    expected_rate: '',
    applicant_notes: ''
  });
  const [cv, setCv] = useState<File | null>(null);
  const [skillId, setSkillId] = useState('');

  useEffect(() => {
    getPublicJob(slug)
      .then(setJob)
      .catch(() => setNotFoundState(true))
      .finally(() => setLoading(false));
  }, [slug]);

  if (notFoundState) notFound();

  const isFreelance = job?.recruitment_type === 'FREELANCE';
  // FREELANCE job: applicant picks ONE position from the job's Skill & Kategori.
  const skillOptions = isFreelance ? (job?.skill_details ?? []) : [];
  const skillGroups = skillOptions.reduce<Record<string, typeof skillOptions>>((acc, s) => {
    const category = s.category || 'Lainnya';
    (acc[category] ??= []).push(s);
    return acc;
  }, {});

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!job) return;
    if (!form.full_name.trim() || !form.email.trim()) {
      toast.error('Nama dan email wajib diisi.');
      return;
    }
    if (skillOptions.length > 0 && !skillId) {
      toast.error('Pilih posisi yang sesuai.');
      return;
    }
    if (isFreelance && !cv && !form.portfolio_url.trim()) {
      toast.error('Upload CV atau isi URL portfolio.');
      return;
    }
    const cvProblem = cv ? cvError(cv) : null;
    if (cvProblem) {
      toast.error(cvProblem);
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
        skill_id: skillOptions.length > 0 ? Number(skillId) : null,
        ...(isFreelance
          ? {
              domicile: form.domicile.trim(),
              portfolio_url: form.portfolio_url.trim(),
              expected_rate: form.expected_rate.trim(),
              applicant_notes: form.applicant_notes.trim()
            }
          : {}),
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
              {job.position_text && (
                <span className='text-muted-foreground text-sm'>· {job.position_text}</span>
              )}
            </div>
            <CardTitle className='text-2xl font-bold tracking-tight'>{job.title}</CardTitle>
            <CardDescription>
              {job.recruitment_type === 'FREELANCE' ? 'Freelance' : employmentLabel(job.employment_type)}
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
                  {skillOptions.length > 0 && (
                    <div>
                      <Label className='text-xs' htmlFor='apply-skill'>
                        Posisi yang Sesuai*
                      </Label>
                      <select
                        id='apply-skill'
                        className='border-input h-9 w-full rounded-lg border bg-transparent px-2.5 text-sm'
                        value={skillId}
                        onChange={(e) => setSkillId(e.target.value)}
                      >
                        <option value=''>Pilih posisi</option>
                        {Object.entries(skillGroups).map(([category, items]) => (
                          <optgroup key={category} label={category}>
                            {items.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </div>
                  )}
                  <div>
                    <Label className='text-xs'>Telepon</Label>
                    <Input
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                      placeholder='08xx'
                    />
                  </div>
                  {isFreelance && (
                    <>
                      <div>
                        <Label className='text-xs'>Domisili</Label>
                        <Input
                          value={form.domicile}
                          onChange={(e) => setForm({ ...form, domicile: e.target.value })}
                          placeholder='Kota domisili'
                        />
                      </div>
                      <div>
                        <Label className='text-xs'>URL Portfolio</Label>
                        <Input
                          type='url'
                          value={form.portfolio_url}
                          onChange={(e) => setForm({ ...form, portfolio_url: e.target.value })}
                          placeholder='https://...'
                        />
                      </div>
                      <div>
                        <Label className='text-xs'>Rate yang Diharapkan</Label>
                        <Input
                          value={form.expected_rate}
                          onChange={(e) => setForm({ ...form, expected_rate: e.target.value })}
                          placeholder='mis. Rp 1.500.000/event'
                        />
                      </div>
                      <div>
                        <Label className='text-xs'>Catatan</Label>
                        <Input
                          value={form.applicant_notes}
                          onChange={(e) => setForm({ ...form, applicant_notes: e.target.value })}
                          placeholder='Pengalaman singkat, ketersediaan, dll.'
                        />
                      </div>
                    </>
                  )}
                  <div>
                    <Label className='text-xs'>
                      CV (PDF/DOC){isFreelance ? ' — wajib jika tidak mengisi URL portfolio' : ''}
                    </Label>
                    <Input
                      type='file'
                      accept='.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                      onChange={(e) => {
                        const picked = e.target.files?.[0] || null;
                        const problem = picked ? cvError(picked) : null;
                        if (problem) {
                          toast.error(problem);
                          e.target.value = '';
                          setCv(null);
                          return;
                        }
                        setCv(picked);
                      }}
                    />
                    <p className='text-muted-foreground mt-1 text-xs'>Format file: PDF atau DOC (Word) · Ukuran maks. 5 MB</p>
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
