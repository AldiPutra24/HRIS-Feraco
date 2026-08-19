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
  createPosition,
  deletePosition,
  listDepartments,
  listPositions,
  updatePosition,
  type Department,
  type Position
} from '@/lib/employees';

type FormState = { name: string; code: string; department: string };

function apiError(err: unknown): string {
  if (err instanceof Error) {
    try {
      const d = JSON.parse(err.message);
      if (typeof d.detail === 'string') return d.detail;
      if (typeof d.name === 'string') return `Nama: ${d.name}`;
      return err.message;
    } catch {
      return err.message;
    }
  }
  return 'Terjadi kesalahan.';
}

export function PositionList() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState<Position | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>({ name: '', code: '', department: '' });
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await listPositions();
      setPositions(data);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    listDepartments().then((ds) => setDepartments(ds)).catch(() => {});
  }, []);

  const filtered = positions.filter((p) => {
    if (status && (p.is_active ? 'ACTIVE' : 'INACTIVE') !== status) return false;
    if (deptFilter && p.department !== Number(deptFilter)) return false;
    if (search && !`${p.name} ${p.code}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  function openAdd() {
    setEditing(null);
    setForm({ name: '', code: '', department: deptFilter || '' });
    setFormError('');
    setShowForm(true);
  }

  function openEdit(p: Position) {
    setEditing(p);
    setForm({ name: p.name, code: p.code, department: p.department ? String(p.department) : '' });
    setFormError('');
    setShowForm(true);
  }

  function closeForm() {
    setEditing(null);
    setForm({ name: '', code: '', department: '' });
    setFormError('');
    setShowForm(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    if (!form.name.trim()) {
      setFormError('Nama position wajib diisi.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        code: form.code.trim(),
        department: form.department ? Number(form.department) : null
      };
      if (editing) await updatePosition(editing.id, payload);
      else await createPosition(payload);
      closeForm();
      load();
    } catch (err) {
      setFormError(apiError(err));
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(p: Position, active: boolean) {
    try {
      await updatePosition(p.id, { is_active: active });
      load();
    } catch (err) {
      setError(apiError(err));
    }
  }

  async function handleDelete(p: Position) {
    if (!window.confirm(`Hapus position ${p.name}?`)) return;
    try {
      await deletePosition(p.id);
      load();
    } catch (err) {
      setError(apiError(err));
    }
  }

  return (
    <div className='flex flex-1 flex-col gap-4 p-4 md:p-6'>
      <div className='flex items-center justify-between'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>Positions</h2>
          <p className='text-muted-foreground text-sm'>Kelola master data position.</p>
        </div>
        <Button onClick={openAdd}>
          <Icons.add />
          Tambah Position
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>{editing ? 'Edit Position' : 'Tambah Position'}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className='space-y-4'>
              {formError && <p className='text-destructive text-sm'>{formError}</p>}
              <div className='grid grid-cols-1 gap-4 md:grid-cols-3'>
                <div className='space-y-1.5'>
                  <Label>Department</Label>
                  <select
                    className='border-input h-8 rounded-lg border bg-transparent px-2.5 text-sm'
                    value={form.department}
                    onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}
                  >
                    <option value=''>-</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className='space-y-1.5'>
                  <Label>Nama Position</Label>
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
          value={deptFilter}
          onChange={(e) => setDeptFilter(e.target.value)}
          className='border-input h-8 rounded-lg border bg-transparent px-2.5 text-sm'
        >
          <option value=''>Semua Department</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
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
                  <TableHead>Position</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Karyawan</TableHead>
                  <TableHead className='text-right'>Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className='font-medium'>{p.name}</TableCell>
                    <TableCell>{p.department_name || '-'}</TableCell>
                    <TableCell>
                      <div className='flex items-center gap-2'>
                        <Switch checked={p.is_active} onCheckedChange={(v) => toggleActive(p, v)} />
                        <Badge variant={p.is_active ? 'default' : 'secondary'}>
                          {p.is_active ? 'ACTIVE' : 'INACTIVE'}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell>{p.employee_count ?? '-'}</TableCell>
                    <TableCell className='text-right'>
                      <div className='flex items-center justify-end gap-2'>
                        <Button variant='ghost' size='sm' onClick={() => openEdit(p)}>
                          <Icons.edit />
                          Edit
                        </Button>
                        <Button variant='ghost' size='sm' onClick={() => handleDelete(p)}>
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
