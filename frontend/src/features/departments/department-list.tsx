'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Icons } from '@/components/icons';
import {
  createDepartment,
  deleteDepartment,
  listDepartments,
  updateDepartment,
  type Department
} from '@/lib/employees';

type FormState = { name: string; code: string };

function apiError(err: unknown): string {
  if (err instanceof Error) {
    try {
      const d = JSON.parse(err.message);
      return typeof d.detail === 'string' ? d.detail : err.message;
    } catch {
      return err.message;
    }
  }
  return 'Terjadi kesalahan.';
}

export function DepartmentList() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState<Department | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>({ name: '', code: '' });
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await listDepartments();
      setDepartments(data);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = departments.filter((d) => {
    if (status && (d.is_active ? 'ACTIVE' : 'INACTIVE') !== status) return false;
    if (search && !`${d.name} ${d.code}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  function openAdd() {
    setEditing(null);
    setForm({ name: '', code: '' });
    setFormError('');
    setShowForm(true);
  }

  function openEdit(d: Department) {
    setEditing(d);
    setForm({ name: d.name, code: d.code });
    setFormError('');
    setShowForm(true);
  }

  function closeForm() {
    setEditing(null);
    setForm({ name: '', code: '' });
    setFormError('');
    setShowForm(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    if (!form.name.trim()) {
      setFormError('Nama department wajib diisi.');
      return;
    }
    setSaving(true);
    try {
      if (editing) await updateDepartment(editing.id, { name: form.name.trim(), code: form.code.trim() });
      else await createDepartment({ name: form.name.trim(), code: form.code.trim() });
      closeForm();
      load();
    } catch (err) {
      setFormError(apiError(err));
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(d: Department, active: boolean) {
    try {
      await updateDepartment(d.id, { is_active: active });
      load();
    } catch (err) {
      setError(apiError(err));
    }
  }

  async function handleDelete(d: Department) {
    if (!window.confirm(`Hapus department ${d.name}?`)) return;
    try {
      await deleteDepartment(d.id);
      load();
    } catch (err) {
      setError(apiError(err));
    }
  }

  const showFormVisible = showForm;

  return (
    <div className='flex flex-1 flex-col gap-4 p-4 md:p-6'>
      <div className='flex items-center justify-between'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>Departments</h2>
          <p className='text-muted-foreground text-sm'>Kelola master data department.</p>
        </div>
        <Button onClick={openAdd}>
          <Icons.add />
          Tambah Department
        </Button>
      </div>

      {showFormVisible && (
        <Card>
          <CardHeader>
            <CardTitle>{editing ? 'Edit Department' : 'Tambah Department'}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className='space-y-4'>
              {formError && <p className='text-destructive text-sm'>{formError}</p>}
              <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
                <div className='space-y-1.5'>
                  <Label>Nama</Label>
                  <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
                </div>
                <div className='space-y-1.5'>
                  <Label>Kode (opsional)</Label>
                  <Input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} />
                </div>
              </div>
              <div className='flex justify-end gap-2'>
                <Button type='button' variant='outline' onClick={closeForm}>
                  Batal
                </Button>
                <Button type='submit' disabled={saving}>
                  {saving ? 'Menyimpan...' : 'Simpan'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className='flex flex-wrap gap-2'>
        <div className='relative w-64'>
          <Icons.search className='text-muted-foreground absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2' />
          <Input
            placeholder='Cari nama / kode'
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className='pl-8'
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className='border-input h-8 rounded-lg border bg-transparent px-2.5 text-sm'
        >
          <option value=''>Semua Status</option>
          <option value='ACTIVE'>Active</option>
          <option value='INACTIVE'>Inactive</option>
        </select>
      </div>

      {error && <p className='text-destructive text-sm'>{error}</p>}

      <Card>
        <CardContent className='p-0'>
          {loading ? (
            <div className='space-y-2 p-4'>
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className='h-8 w-full' />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nama</TableHead>
                  <TableHead>Kode</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Karyawan</TableHead>
                  <TableHead className='text-right'>Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className='font-medium'>{d.name}</TableCell>
                    <TableCell>{d.code || '-'}</TableCell>
                    <TableCell>
                      <div className='flex items-center gap-2'>
                        <Switch checked={d.is_active} onCheckedChange={(v) => toggleActive(d, v)} />
                        <Badge variant={d.is_active ? 'default' : 'secondary'}>
                          {d.is_active ? 'ACTIVE' : 'INACTIVE'}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell>{d.employee_count ?? '-'}</TableCell>
                    <TableCell className='text-right'>
                      <div className='flex items-center justify-end gap-2'>
                        <Button variant='ghost' size='sm' onClick={() => openEdit(d)}>
                          <Icons.edit />
                          Edit
                        </Button>
                        <Button variant='ghost' size='sm' onClick={() => handleDelete(d)}>
                          <Icons.trash />
                          Hapus
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className='text-muted-foreground py-8 text-center'>
                      Tidak ada data.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
