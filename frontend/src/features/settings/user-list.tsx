'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Icons } from '@/components/icons';
import {
  createUser,
  deleteUser,
  listRoles,
  listUsers,
  updateUser,
  type AdminUser,
  type Role
} from '@/lib/users';
import { listEmployees, type Employee } from '@/lib/employees';

type FormState = {
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  is_active: boolean;
  password: string;
  employee: string;
};

function apiError(err: unknown): string {
  if (err instanceof Error) {
    try {
      const d = JSON.parse(err.message);
      if (typeof d.detail === 'string') return d.detail;
      const first = Object.entries(d).map(([k, v]) => `${k}: ${Array.isArray(v) ? v[0] : v}`).join('; ');
      if (first) return first;
      return err.message;
    } catch {
      return err.message;
    }
  }
  return 'Terjadi kesalahan.';
}

const EMPTY: FormState = { username: '', email: '', first_name: '', last_name: '', role: '', is_active: true, password: '', employee: '' };

export function UserList() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [us, rs, es] = await Promise.all([listUsers(), listRoles(), listEmployees({ page_size: '1000' })]);
      setUsers(us);
      setRoles(rs);
      setEmployees(es.results);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = users.filter((u) => {
    if (search && !`${u.username} ${u.email} ${u.first_name} ${u.last_name}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  function openAdd() {
    setEditing(null);
    setForm(EMPTY);
    setFormError('');
    setShowForm(true);
  }

  function openEdit(u: AdminUser) {
    setEditing(u);
    setForm({
      username: u.username,
      email: u.email,
      first_name: u.first_name,
      last_name: u.last_name,
      role: u.role ? String(u.role) : '',
      is_active: u.is_active,
      password: '',
      employee: u.employee_id ? String(u.employee_id) : ''
    });
    setFormError('');
    setShowForm(true);
  }

  function closeForm() {
    setEditing(null);
    setForm(EMPTY);
    setFormError('');
    setShowForm(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    if (!form.email.trim() || !form.username.trim()) {
      setFormError('Username dan email wajib diisi.');
      return;
    }
    if (!editing && !form.password) {
      setFormError('Password wajib diisi untuk user baru.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        username: form.username.trim(),
        email: form.email.trim(),
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        role: form.role ? Number(form.role) : null,
        is_active: form.is_active,
        employee: form.employee ? Number(form.employee) : null,
        ...(form.password ? { password: form.password } : {})
      };
      if (editing) await updateUser(editing.id, payload);
      else await createUser(payload);
      closeForm();
      load();
    } catch (err) {
      setFormError(apiError(err));
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(u: AdminUser, active: boolean) {
    try {
      await updateUser(u.id, { is_active: active });
      load();
    } catch (err) {
      setError(apiError(err));
    }
  }

  async function handleDelete(u: AdminUser, hard = false) {
    const label = hard ? `Hapus permanen user ${u.username}? Data tidak bisa dikembalikan.` : `Hapus user ${u.username}?`;
    if (!window.confirm(label)) return;
    try {
      await deleteUser(u.id, hard);
      load();
    } catch (err) {
      setError(apiError(err));
    }
  }

  const roleName = (roleKey: string | null) => roles.find((r) => r.key === roleKey)?.name ?? roleKey ?? '-';
  const selectedRoleKey = roles.find((r) => String(r.id) === form.role)?.key ?? null;
  const isEmployeeRole = selectedRoleKey === 'EMPLOYEE';

  return (
    <div className='flex flex-1 flex-col gap-4 p-4 md:p-6'>
      <div className='flex items-center justify-between'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>Users</h2>
          <p className='text-muted-foreground text-sm'>Kelola user dan role.</p>
        </div>
        <Button onClick={openAdd}>
          <Icons.add />
          Tambah User
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>{editing ? 'Edit User' : 'Tambah User'}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className='space-y-4'>
              {formError && <p className='text-destructive text-sm'>{formError}</p>}
              <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
                <div className='space-y-1.5'>
                  <Label>Username</Label>
                  <Input value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} />
                </div>
                <div className='space-y-1.5'>
                  <Label>Email</Label>
                  <Input type='email' value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
                </div>
                <div className='space-y-1.5'>
                  <Label>Nama</Label>
                  <Input value={form.first_name} onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))} />
                </div>
                <div className='space-y-1.5'>
                  <Label>Role</Label>
                  <select
                    className='border-input h-8 rounded-lg border bg-transparent px-2.5 text-sm'
                    value={form.role}
                    onChange={(e) => setForm((f) => ({ ...f, role: e.target.value, employee: '' }))}
                  >
                    <option value=''>-</option>
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </div>
                {isEmployeeRole && (
                  <div className='space-y-1.5'>
                    <Label>Karyawan</Label>
                  <select
                    className='border-input h-8 rounded-lg border bg-transparent px-2.5 text-sm'
                    value={form.employee}
                    onChange={(e) => {
                      const employee = employees.find((emp) => emp.id === Number(e.target.value));
                      setForm((f) => ({
                        ...f,
                        employee: e.target.value,
                        ...(employee
                          ? {
                              first_name: employee.full_name,
                              last_name: '',
                              email: employee.personal_email || f.email,
                              username: f.username || employee.employee_id.toLowerCase()
                            }
                          : {})
                      }));
                    }}
                  >
                    <option value=''>-</option>
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.full_name}
                      </option>
                    ))}
                  </select>
                  </div>
                )}
                <div className='space-y-1.5'>
                  <Label>Password {editing ? '(kosongkan jika tidak diubah)' : ''}</Label>
                  <Input type='password' value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />
                </div>
                <div className='flex items-center gap-2'>
                  <Switch checked={form.is_active} onCheckedChange={(v) => setForm((f) => ({ ...f, is_active: v }))} />
                  <Label>Active</Label>
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

      <div className='relative w-64'>
        <Icons.search className='text-muted-foreground absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2' />
        <Input
          placeholder='Cari nama / email'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className='pl-8'
        />
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
                  <TableHead>Username</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Nama</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Karyawan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className='text-right'>Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className='font-medium'>{u.username}</TableCell>
                    <TableCell>{u.email}</TableCell>
                    <TableCell>{[u.first_name, u.last_name].filter(Boolean).join(' ') || '-'}</TableCell>
                    <TableCell>
                      <Badge variant='outline'>{roleName(u.role_key)}</Badge>
                    </TableCell>
                    <TableCell>
                      {u.employee_id ? (
                        <Badge variant={u.is_active ? 'default' : 'secondary'}>{u.employee_name}</Badge>
                      ) : (
                        <span className='text-muted-foreground text-sm'>Not Created</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className='flex items-center gap-2'>
                        <Switch checked={u.is_active} onCheckedChange={(v) => toggleActive(u, v)} />
                        <Badge variant={u.is_active ? 'default' : 'secondary'}>
                          {u.is_active ? 'ACTIVE' : 'INACTIVE'}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className='text-right'>
                      <div className='flex items-center justify-end gap-2'>
                        <Button variant='ghost' size='sm' onClick={() => openEdit(u)}>
                          <Icons.edit />
                          Edit
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger render={<Button variant='ghost' size='sm'><Icons.trash /> Hapus</Button>} />
                          <DropdownMenuContent align='end'>
                            <DropdownMenuItem onClick={() => handleDelete(u)}>
                              Hapus (soft)
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant='destructive' onClick={() => handleDelete(u, true)}>
                              Hapus permanen
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className='text-muted-foreground py-8 text-center'>
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
