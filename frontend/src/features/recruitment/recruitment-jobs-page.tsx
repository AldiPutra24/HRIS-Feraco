'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'react-toastify';
import { useAuth } from '@/lib/auth/auth-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { listDepartments, listPositions, type Department, type Position } from '@/lib/employees';
import {
  closeJob,
  createJob,
  deleteJob,
  hardDeleteJob,
  listJobs,
  openJob,
  reopenJob,
  updateJob,
  type Job,
  type JobInput
} from '@/lib/recruitment';

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  DRAFT: 'outline',
  OPEN: 'default',
  CLOSED: 'secondary'
};

const STATUS_OPTIONS = ['DRAFT', 'OPEN', 'CLOSED'];
const EMPLOYMENT_OPTIONS = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP', 'FREELANCE'];

function StatusBadge({ status }: { status: string }) {
  return <Badge variant={STATUS_VARIANT[status] ?? 'secondary'}>{status}</Badge>;
}

function employmentLabel(v: string): string {
  return v.replace('_', ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

const RECRUITMENT_BASE =
  process.env.NEXT_PUBLIC_RECRUITMENT_URL || (typeof window !== 'undefined' ? window.location.origin : '');

function publicUrl(slug: string): string {
  if (!RECRUITMENT_BASE) return '';
  return `${RECRUITMENT_BASE}/jobs/${slug}`;
}

const emptyForm: JobInput = {
  title: '',
  department: null,
  position: null,
  description: '',
  requirements: '',
  employment_type: 'FULL_TIME',
  location: '',
  open_date: new Date().toISOString().slice(0, 10),
  close_date: ''
};

export function RecruitmentJobsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const fStatus = searchParams.get('status') ?? '';
  const fSearch = searchParams.get('q') ?? '';

  function setFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams);
    if (value) params.set(key, value);
    else params.delete(key);
    router.replace(`/dashboard/recruitment/jobs${params.size ? `?${params}` : ''}`);
  }

  const [items, setItems] = useState<Job[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Job | null>(null);
  const [form, setForm] = useState<JobInput>(emptyForm);

  const load = useCallback(async () => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (fStatus) params.status = fStatus;
    if (fSearch) params.search = fSearch;
    try {
      const jobs = await listJobs(params);
      setItems(jobs);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal memuat data.');
    } finally {
      setLoading(false);
    }
  }, [fStatus, fSearch]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    listDepartments().then(setDepartments).catch(() => {});
    listPositions().then(setPositions).catch(() => {});
  }, []);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setFormOpen(true);
  }

  function openEdit(job: Job) {
    setEditing(job);
    setForm({
      title: job.title,
      department: job.department,
      position: job.position,
      description: job.description,
      requirements: job.requirements,
      employment_type: job.employment_type,
      location: job.location,
      open_date: job.open_date,
      close_date: job.close_date ?? ''
    });
    setFormOpen(true);
  }

  async function saveForm() {
    if (!form.title.trim()) {
      toast.error('Judul wajib diisi.');
      return;
    }
    if (!form.open_date) {
      toast.error('Open date wajib diisi.');
      return;
    }
    const payload = { ...form, close_date: form.close_date || null };
    try {
      const saved = editing ? await updateJob(editing.id, payload) : await createJob(payload);
      toast.success(editing ? 'Job diperbarui.' : 'Job dibuat.');
      setFormOpen(false);
      if (saved.status === 'OPEN') {
        toast.info(`Public link: ${publicUrl(saved.slug)}`);
      }
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan.');
    }
  }

  async function act(id: number, fn: (id: number) => Promise<unknown>, msg: string) {
    try {
      await fn(id);
      toast.success(msg);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Aksi gagal.');
    }
  }

  async function handleDelete(job: Job) {
    if (!window.confirm(`Hapus job "${job.title}"? Tindakan ini permanen.`)) return;
    await act(job.id, deleteJob, 'Job dihapus.');
  }

  async function handleHardDelete(job: Job) {
    if (!window.confirm(`Hapus permanen job "${job.title}"? Tidak dapat dibatalkan.`)) return;
    await act(job.id, hardDeleteJob, 'Job dihapus permanen.');
  }

  function copyLink(slug: string) {
    navigator.clipboard.writeText(publicUrl(slug)).then(
      () => toast.success('Link disalin.'),
      () => toast.error('Gagal menyalin link.')
    );
  }

  const deptPositions = form.department
    ? positions.filter((p) => p.department === form.department)
    : positions;

  if (loading && items.length === 0) {
    return (
      <div className='space-y-2 p-4 md:p-6'>
        <Skeleton className='h-8 w-64' />
        <Skeleton className='h-40 w-full' />
      </div>
    );
  }

  return (
    <div className='flex flex-1 flex-col gap-4 p-4 md:p-6'>
      <div className='flex items-center justify-between'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>Job Management</h2>
          <p className='text-muted-foreground text-sm'>Kelola lowongan kerja dan portal publik.</p>
        </div>
        <Button onClick={openCreate}>Add New Job</Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filter</CardTitle>
        </CardHeader>
        <CardContent>
          <div className='grid grid-cols-1 gap-3 md:grid-cols-3'>
            <div>
              <Label className='text-xs'>Cari</Label>
              <Input
                placeholder='Judul / lokasi'
                value={fSearch}
                onChange={(e) => setFilter('q', e.target.value)}
              />
            </div>
            <div>
              <Label className='text-xs'>Status</Label>
              <select
                className='border-input h-9 w-full rounded-lg border bg-transparent px-2.5 text-sm'
                value={fStatus}
                onChange={(e) => setFilter('status', e.target.value)}
              >
                <option value=''>Semua status</option>
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className='flex items-end'>
              <Button variant='ghost' onClick={() => router.replace('/dashboard/recruitment/jobs')}>
                Reset
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Daftar Lowongan</CardTitle>
        </CardHeader>
        <CardContent className='p-0'>
          {items.length === 0 ? (
            <p className='text-muted-foreground p-6 text-center'>Belum ada lowongan.</p>
          ) : (
            <div className='overflow-x-auto'>
              <table className='w-full text-sm'>
                <TableHeader>
                  <TableRow>
                    <TableHead>Job Title</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Position</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Open Date</TableHead>
                    <TableHead>Close Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className='text-right'>Applications</TableHead>
                    <TableHead>Public URL</TableHead>
                    <TableHead className='text-right'>Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((j) => (
                    <TableRow key={j.id}>
                      <TableCell className='font-medium'>{j.title}</TableCell>
                      <TableCell>{j.department_name || '-'}</TableCell>
                      <TableCell>{j.position_name || '-'}</TableCell>
                      <TableCell>{employmentLabel(j.employment_type)}</TableCell>
                      <TableCell>{j.location || '-'}</TableCell>
                      <TableCell>{j.open_date}</TableCell>
                      <TableCell>{j.close_date ?? '-'}</TableCell>
                      <TableCell>
                        <StatusBadge status={j.status} />
                      </TableCell>
                      <TableCell className='text-right'>
                        <button
                          className='text-primary hover:underline'
                          onClick={() => router.push(`/dashboard/recruitment/jobs/${j.id}/applications`)}
                        >
                          {j.applications_count}
                        </button>
                      </TableCell>
                      <TableCell>
                        {j.status === 'OPEN' && (
                          <button
                            className='text-primary underline'
                            onClick={() => copyLink(j.slug)}
                          >
                            Copy Link
                          </button>
                        )}
                      </TableCell>
                      <TableCell className='text-right'>
                        <div className='flex justify-end gap-1'>
                          <Button size='sm' variant='ghost' onClick={() => openEdit(j)}>
                            Edit
                          </Button>
                          {j.status === 'DRAFT' && (
                            <Button size='sm' variant='ghost' onClick={() => act(j.id, openJob, 'Job dibuka.')}>
                              Open
                            </Button>
                          )}
                          {j.status === 'OPEN' && (
                            <Button size='sm' variant='ghost' onClick={() => act(j.id, closeJob, 'Job ditutup.')}>
                              Close
                            </Button>
                          )}
                          {j.status === 'CLOSED' && (
                            <Button size='sm' variant='ghost' onClick={() => act(j.id, reopenJob, 'Job dibuka ulang.')}>
                              Reopen
                            </Button>
                          )}
                          {j.status === 'DRAFT' && (
                            <Button size='sm' variant='destructive' onClick={() => handleDelete(j)}>
                              Delete
                            </Button>
                          )}
                          {isAdmin && (
                            <Button size='sm' variant='destructive' onClick={() => handleHardDelete(j)}>
                              Hapus Permanen
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {formOpen && (
        <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4'>
          <Card className='max-h-[90vh] w-full max-w-2xl overflow-y-auto'>
            <CardHeader>
              <CardTitle>{editing ? 'Edit Job' : 'Add New Job'}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>
                <div className='md:col-span-2'>
                  <Label className='text-xs'>Judul *</Label>
                  <Input
                    placeholder='Misal: Software Engineer'
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                  />
                </div>
                <div>
                  <Label className='text-xs'>Department</Label>
                  <select
                    className='border-input h-9 w-full rounded-lg border bg-transparent px-2.5 text-sm'
                    value={form.department ?? ''}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        department: e.target.value ? Number(e.target.value) : null,
                        position: null
                      })
                    }
                  >
                    <option value=''>-</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label className='text-xs'>Position</Label>
                  <select
                    className='border-input h-9 w-full rounded-lg border bg-transparent px-2.5 text-sm'
                    value={form.position ?? ''}
                    onChange={(e) => setForm({ ...form, position: e.target.value ? Number(e.target.value) : null })}
                  >
                    <option value=''>-</option>
                    {deptPositions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label className='text-xs'>Employment Type</Label>
                  <select
                    className='border-input h-9 w-full rounded-lg border bg-transparent px-2.5 text-sm'
                    value={form.employment_type}
                    onChange={(e) => setForm({ ...form, employment_type: e.target.value })}
                  >
                    {EMPLOYMENT_OPTIONS.map((t) => (
                      <option key={t} value={t}>
                        {employmentLabel(t)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label className='text-xs'>Location</Label>
                  <Input
                    placeholder='Misal: Jakarta'
                    value={form.location}
                    onChange={(e) => setForm({ ...form, location: e.target.value })}
                  />
                </div>
                <div>
                  <Label className='text-xs'>Open Date *</Label>
                  <Input
                    type='date'
                    value={form.open_date}
                    onChange={(e) => setForm({ ...form, open_date: e.target.value })}
                  />
                </div>
                <div>
                  <Label className='text-xs'>Close Date</Label>
                  <Input
                    type='date'
                    value={form.close_date ?? ''}
                    onChange={(e) => setForm({ ...form, close_date: e.target.value })}
                  />
                </div>
                <div className='md:col-span-2'>
                  <Label className='text-xs' htmlFor='job-description'>
                    Deskripsi
                  </Label>
                  <textarea
                    id='job-description'
                    aria-label='Deskripsi'
                    className='border-input min-h-24 w-full rounded-lg border bg-transparent p-2.5 text-sm'
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                  />
                </div>
                <div className='md:col-span-2'>
                  <Label className='text-xs' htmlFor='job-requirements'>
                    Requirements
                  </Label>
                  <textarea
                    id='job-requirements'
                    aria-label='Requirements'
                    className='border-input min-h-24 w-full rounded-lg border bg-transparent p-2.5 text-sm'
                    value={form.requirements}
                    onChange={(e) => setForm({ ...form, requirements: e.target.value })}
                  />
                </div>
              </div>
              <div className='mt-4 flex justify-end gap-2'>
                <Button variant='ghost' onClick={() => setFormOpen(false)}>
                  Batal
                </Button>
                <Button onClick={saveForm}>{editing ? 'Simpan' : 'Buat Job'}</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
