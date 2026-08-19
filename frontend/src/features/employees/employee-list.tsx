'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Icons } from '@/components/icons';
import { useAuth } from '@/lib/auth/auth-provider';
import {
  deleteEmployee,
  listDepartments,
  listEmployees,
  listPositions,
  type Department,
  type Employee,
  type Position
} from '@/lib/employees';
import { EmployeeForm } from './employee-form';
import { ImportDialog } from './import-dialog';

function StatusBadge({ status }: { status: string }) {
  const variant = status === 'ACTIVE' ? 'default' : 'secondary';
  return <Badge variant={variant}>{status}</Badge>;
}

export function EmployeeList() {
  const { user } = useAuth();
  const canDelete = user?.role === 'admin' || user?.role === 'hr_lead';
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('');
  const [position, setPosition] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [importOpen, setImportOpen] = useState(false);

  async function load() {
    setLoading(true);
    const data = await listEmployees({ search, department, position, employment_status: status, page });
    setEmployees(data.results);
    setCount(data.count);
    setLoading(false);
  }

  async function handleDelete(e: Employee) {
    if (!window.confirm(`Hapus karyawan ${e.full_name}?`)) return;
    await deleteEmployee(e.id);
    load();
  }

  useEffect(() => {
    listDepartments().then(setDepartments);
    listPositions().then(setPositions);
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, department, position, status, page]);

  const totalPages = Math.max(1, Math.ceil(count / 20));

  return (
    <div className='flex flex-1 flex-col gap-4 p-4 md:p-6'>
      <div className='flex items-center justify-between'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>Karyawan</h2>
          <p className='text-muted-foreground text-sm'>Kelola data karyawan.</p>
        </div>
        <div className='flex gap-2'>
          <Button variant='outline' onClick={() => setImportOpen(true)}>
            <Icons.upload />
            Import CSV
          </Button>
          <Button onClick={() => { setEditing(null); setShowForm((v) => !v); }}>
            <Icons.add />
            Tambah Karyawan
          </Button>
        </div>
      </div>

      <ImportDialog open={importOpen} onOpenChange={setImportOpen} onImported={load} />

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>{editing ? 'Edit Karyawan' : 'Tambah Karyawan'}</CardTitle>
          </CardHeader>
          <CardContent>
            <EmployeeForm
              employee={editing}
              onSaved={() => {
                setShowForm(false);
                setEditing(null);
                load();
              }}
              onCancel={() => {
                setShowForm(false);
                setEditing(null);
              }}
            />
          </CardContent>
        </Card>
      )}

      <div className='flex flex-wrap gap-2'>
        <div className='relative w-64'>
          <Icons.search className='text-muted-foreground absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2' />
          <Input
            placeholder='Cari nama / NIK / email'
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
            className='pl-8'
          />
        </div>
        <select
          value={department}
          onChange={(e) => {
            setPage(1);
            setDepartment(e.target.value);
          }}
          className='border-input h-8 rounded-lg border bg-transparent px-2.5 text-sm'
        >
          <option value=''>Semua Departemen</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <select
          value={position}
          onChange={(e) => {
            setPage(1);
            setPosition(e.target.value);
          }}
          className='border-input h-8 rounded-lg border bg-transparent px-2.5 text-sm'
        >
          <option value=''>Semua Posisi</option>
          {positions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => {
            setPage(1);
            setStatus(e.target.value);
          }}
          className='border-input h-8 rounded-lg border bg-transparent px-2.5 text-sm'
        >
          <option value=''>Semua Status</option>
          <option value='ACTIVE'>Active</option>
          <option value='INACTIVE'>Inactive</option>
        </select>
      </div>

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
                  <TableHead>ID</TableHead>
                  <TableHead>Nama</TableHead>
                  <TableHead>Departemen</TableHead>
                  <TableHead>Posisi</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className='text-right'>Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {employees.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>{e.employee_id}</TableCell>
                    <TableCell className='font-medium'>{e.full_name}</TableCell>
                    <TableCell>{e.department_name || '-'}</TableCell>
                    <TableCell>{e.position_name || '-'}</TableCell>
                    <TableCell>
                      <StatusBadge status={e.employment_status} />
                    </TableCell>
                    <TableCell className='text-right'>
                      <div className='flex items-center justify-end gap-2'>
                        <Link
                          href={`/dashboard/karyawan/${e.id}`}
                          className='text-primary inline-flex items-center text-sm font-medium hover:underline'
                        >
                          Detail
                        </Link>
                        <Button
                          variant='ghost'
                          size='sm'
                          onClick={() => {
                            setEditing(e);
                            setShowForm(true);
                          }}
                        >
                          <Icons.edit />
                          Edit
                        </Button>
                        {canDelete && (
                          <Button variant='ghost' size='sm' onClick={() => handleDelete(e)}>
                            <Icons.trash />
                            Hapus
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {employees.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className='text-muted-foreground py-8 text-center'>
                      Tidak ada data.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className='flex items-center justify-between'>
        <p className='text-muted-foreground text-sm'>{count} karyawan</p>
        <div className='flex gap-2'>
          <Button variant='outline' size='sm' disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            <Icons.chevronLeft />
          </Button>
          <span className='text-sm self-center'>
            {page} / {totalPages}
          </span>
          <Button variant='outline' size='sm' disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            <Icons.chevronRight />
          </Button>
        </div>
      </div>
    </div>
  );
}
