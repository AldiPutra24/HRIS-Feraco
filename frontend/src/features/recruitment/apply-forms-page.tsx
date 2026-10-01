'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'react-toastify';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Icons } from '@/components/icons';
import { listSkills, type Skill } from '@/lib/freelance';
import {
  createApplyForm,
  deleteApplyForm,
  listApplyForms,
  listFormApplicants,
  updateApplyForm,
  type FreelanceApplyForm,
  type FormApplicant
} from '@/lib/freelance-apply';
import { SkillMultiSelect } from './skill-multi-select';

export function ApplyFormsPage() {
  const [forms, setForms] = useState<FreelanceApplyForm[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<FreelanceApplyForm | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formState, setFormState] = useState({ title: '', description: '', is_active: true, skills: [] as number[] });
  const [saving, setSaving] = useState(false);
  const [applicantsFor, setApplicantsFor] = useState<FreelanceApplyForm | null>(null);
  const [applicants, setApplicants] = useState<FormApplicant[]>([]);
  const [skillFilter, setSkillFilter] = useState<number | ''>('');
  const [loadingApplicants, setLoadingApplicants] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [f, s] = await Promise.all([
        listApplyForms(),
        listSkills().catch(() => [] as Skill[])
      ]);
      setForms(f);
      setSkills(s);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal memuat data.');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const skillName = useMemo(
    () => (id: number) => skills.find((s) => s.id === id)?.name ?? `#${id}`,
    [skills]
  );

  function openCreate() {
    setEditing(null);
    setFormState({ title: '', description: '', is_active: true, skills: [] });
    setShowForm(true);
  }

  function openEdit(f: FreelanceApplyForm) {
    setEditing(f);
    setFormState({ title: f.title, description: f.description, is_active: f.is_active, skills: f.skills });
    setShowForm(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!formState.title.trim()) {
      toast.error('Judul form wajib diisi.');
      return;
    }
    if (formState.skills.length === 0) {
      toast.error('Pilih minimal satu skill/posisi yang dibuka.');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await updateApplyForm(editing.id, formState);
        toast.success('Form diperbarui.');
      } else {
        await createApplyForm(formState);
        toast.success('Form dibuat.');
      }
      setShowForm(false);
      setEditing(null);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan form.');
    }
    setSaving(false);
  }

  async function toggleActive(f: FreelanceApplyForm) {
    try {
      await updateApplyForm(f.id, { is_active: !f.is_active });
      toast.success(f.is_active ? 'Form dinonaktifkan.' : 'Form diaktifkan.');
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal mengubah status form.');
    }
  }

  async function remove(f: FreelanceApplyForm) {
    if (!window.confirm(`Hapus form "${f.title}"?`)) return;
    try {
      await deleteApplyForm(f.id);
      toast.success('Form dihapus.');
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menghapus form.');
    }
  }

  function copyLink(f: FreelanceApplyForm) {
    const url = typeof window !== 'undefined' ? `${window.location.origin}/freelance/apply/${f.slug}` : f.public_url;
    navigator.clipboard.writeText(url).then(
      () => toast.success('Link publik dicopy.'),
      () => toast.error('Gagal copy link.')
    );
  }

  async function openApplicants(f: FreelanceApplyForm, skillId: number | '' = '') {
    setApplicantsFor(f);
    setSkillFilter(skillId);
    setLoadingApplicants(true);
    try {
      setApplicants(await listFormApplicants(f.id, skillId || undefined));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal memuat applicant.');
      setApplicants([]);
    }
    setLoadingApplicants(false);
  }

  return (
    <div className='flex flex-1 flex-col gap-4 p-4 md:p-6'>
      <div className='flex items-center justify-between'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>Form Job Portal Freelance</h2>
          <p className='text-muted-foreground text-sm'>
            Kelola form publik lamaran freelance. Skill/posisi diambil dari master Freelance.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Icons.add />
          Buat Form
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>{editing ? 'Edit Form' : 'Buat Form Baru'}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={save} className='space-y-4'>
              <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
                <div>
                  <Label className='text-xs'>Judul Form *</Label>
                  <Input
                    value={formState.title}
                    onChange={(e) => setFormState((f) => ({ ...f, title: e.target.value }))}
                    placeholder='mis. Open Recruitment Freelance'
                    className='mt-1'
                  />
                </div>
                <div>
                  <Label className='text-xs'>Deskripsi (opsional)</Label>
                  <Input
                    value={formState.description}
                    onChange={(e) => setFormState((f) => ({ ...f, description: e.target.value }))}
                    placeholder='Deskripsi singkat yang tampil di halaman publik'
                    className='mt-1'
                  />
                </div>
              </div>
              <div>
                <Label className='text-xs'>Skill & Kategori yang Dibuka * (multi-select, dari master Freelance)</Label>
                <div className='mt-1'>
                  <SkillMultiSelect
                    skills={skills}
                    value={formState.skills}
                    onChange={(next) => setFormState((f) => ({ ...f, skills: next }))}
                  />
                </div>
              </div>
              <div className='flex items-center gap-2'>
                <input
                  type='checkbox'
                  id='form-active'
                  checked={formState.is_active}
                  onChange={(e) => setFormState((f) => ({ ...f, is_active: e.target.checked }))}
                />
                <Label htmlFor='form-active' className='text-sm'>Aktif (form dapat diakses publik)</Label>
              </div>
              <div className='flex gap-2'>
                <Button type='submit' disabled={saving}>
                  {saving ? 'Menyimpan...' : 'Simpan'}
                </Button>
                <Button
                  type='button'
                  variant='ghost'
                  onClick={() => {
                    setShowForm(false);
                    setEditing(null);
                  }}
                >
                  Batal
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className='p-0'>
          {loading ? (
            <div className='space-y-2 p-4'>
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className='h-10 w-full' />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Form</TableHead>
                  <TableHead>Posisi Dibuka</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Applicants</TableHead>
                  <TableHead className='text-right'>Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {forms.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className='font-medium'>
                      {f.title}
                      <p className='text-muted-foreground max-w-56 truncate text-xs'>/freelance/apply/{f.slug}</p>
                    </TableCell>
                    <TableCell>
                      <div className='flex max-w-72 flex-wrap gap-1'>
                        {f.skill_details.map((s) => (
                          <Badge key={s.id} variant='secondary'>
                            {s.name}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={f.is_active ? 'default' : 'secondary'}>
                        {f.is_active ? 'AKTIF' : 'NONAKTIF'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <button
                        onClick={() => openApplicants(f)}
                        className='text-primary text-sm font-medium hover:underline'
                      >
                        {f.applications_count} applicant
                      </button>
                    </TableCell>
                    <TableCell className='text-right'>
                      <div className='flex items-center justify-end gap-1.5'>
                        <Button variant='ghost' size='sm' onClick={() => copyLink(f)} title='Copy public link'>
                          <Icons.link />
                        </Button>
                        <Button variant='ghost' size='sm' onClick={() => openApplicants(f)}>
                          Applicants
                        </Button>
                        <Button variant='ghost' size='sm' onClick={() => openEdit(f)}>
                          <Icons.edit />
                          Edit
                        </Button>
                        <Button variant='ghost' size='sm' onClick={() => toggleActive(f)}>
                          {f.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                        </Button>
                        <Button variant='ghost' size='sm' onClick={() => remove(f)}>
                          <Icons.trash />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {forms.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className='text-muted-foreground py-8 text-center'>
                      Belum ada form. Klik &quot;Buat Form&quot; untuk membuat link publik.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {applicantsFor && (
        <Card>
          <CardHeader>
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <CardTitle>Applicants — {applicantsFor.title}</CardTitle>
              <Button variant='ghost' size='sm' onClick={() => setApplicantsFor(null)}>
                Tutup
              </Button>
            </div>
            <div className='flex flex-wrap gap-1.5 pt-1'>
              <button
                onClick={() => openApplicants(applicantsFor)}
                className={`rounded-full border px-3 py-1 text-xs ${
                  skillFilter === '' ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-input'
                }`}
              >
                Semua
              </button>
              {applicantsFor.skill_details.map((s) => (
                <button
                  key={s.id}
                  onClick={() => openApplicants(applicantsFor, s.id)}
                  className={`rounded-full border px-3 py-1 text-xs ${
                    skillFilter === s.id ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-input'
                  }`}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent className='p-0'>
            {loadingApplicants ? (
              <div className='space-y-2 p-4'>
                <Skeleton className='h-8 w-full' />
                <Skeleton className='h-8 w-full' />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nama</TableHead>
                    <TableHead>Posisi</TableHead>
                    <TableHead>Kontak</TableHead>
                    <TableHead>Dikirim</TableHead>
                    <TableHead>CV</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {applicants.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className='font-medium'>{a.full_name}</TableCell>
                      <TableCell>
                        <Badge variant='secondary'>{a.skill_name}</Badge>
                      </TableCell>
                      <TableCell className='text-xs'>
                        {a.phone}
                        <br />
                        {a.email}
                      </TableCell>
                      <TableCell className='whitespace-nowrap text-xs'>
                        {new Date(a.submitted_at).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        {a.cv_url ? (
                          <a href={a.cv_url} target='_blank' rel='noreferrer' className='text-primary text-sm hover:underline'>
                            {a.cv_name || 'View'}
                          </a>
                        ) : (
                          <span className='text-muted-foreground text-xs'>URL portfolio</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={a.status === 'APPLIED' ? 'secondary' : 'default'}>{a.status}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                  {applicants.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className='text-muted-foreground py-8 text-center'>
                        Belum ada applicant.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
