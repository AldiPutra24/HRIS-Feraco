'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Icons } from '@/components/icons';
import { listDepartments, listEmployees, listPositions, type Department, type Employee } from '@/lib/employees';

type Summary = {
  total: number;
  active: number;
  inactive: number;
  departments: number;
  positions: number;
};

function StatusBadge({ status }: { status: string }) {
  return <Badge variant={status === 'ACTIVE' ? 'default' : 'secondary'}>{status}</Badge>;
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className='text-2xl font-semibold tabular-nums'>{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

const QUICK_ACTIONS = [
  { label: 'Tambah Karyawan', href: '/dashboard/karyawan', icon: 'add' as const },
  { label: 'Departments', href: '/dashboard/settings/departments', icon: 'teams' as const },
  { label: 'Positions', href: '/dashboard/settings/positions', icon: 'userPlus' as const }
];

export function OverviewDashboard() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [latest, active, inactive, depts, positions] = await Promise.all([
          listEmployees({ ordering: '-created_at' }),
          listEmployees({ employment_status: 'ACTIVE' }),
          listEmployees({ employment_status: 'INACTIVE' }),
          listDepartments(),
          listPositions()
        ]);
        setSummary({
          total: latest.count,
          active: active.count,
          inactive: inactive.count,
          departments: depts.length,
          positions: positions.length
        });
        setEmployees(latest.results.slice(0, 5));
        setDepartments(depts);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className='flex flex-1 flex-col gap-4 p-4 md:p-6'>
      <div className='flex items-center justify-between'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>Dashboard</h2>
          <p className='text-muted-foreground text-sm'>Ringkasan operasional HRIS Feraco.</p>
        </div>
      </div>

      {loading || !summary ? (
        <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5'>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className='h-24 w-full' />
          ))}
        </div>
      ) : (
        <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5'>
          <SummaryCard label='Total Karyawan' value={summary.total} />
          <SummaryCard label='Karyawan Aktif' value={summary.active} />
          <SummaryCard label='Karyawan Nonaktif' value={summary.inactive} />
          <SummaryCard label='Total Department' value={summary.departments} />
          <SummaryCard label='Total Position' value={summary.positions} />
        </div>
      )}

      <div className='grid grid-cols-1 gap-4 lg:grid-cols-3'>
        <Card className='lg:col-span-2'>
          <CardHeader>
            <div className='flex items-center justify-between'>
              <div>
                <CardTitle>Employee Overview</CardTitle>
                <CardDescription>Karyawan terbaru.</CardDescription>
              </div>
              <Link href='/dashboard/karyawan' className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                Lihat Semua Karyawan
              </Link>
            </div>
          </CardHeader>
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
                    <TableHead>Name</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Position</TableHead>
                    <TableHead>Reporting To</TableHead>
                    <TableHead className='text-right'>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {employees.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className='font-medium'>{e.full_name}</TableCell>
                      <TableCell>{e.department_name || '-'}</TableCell>
                      <TableCell>{e.position_name || '-'}</TableCell>
                      <TableCell>{e.manager_name || '-'}</TableCell>
                      <TableCell className='text-right'>
                        <StatusBadge status={e.employment_status} />
                      </TableCell>
                    </TableRow>
                  ))}
                  {employees.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className='text-muted-foreground py-8 text-center'>
                        Tidak ada data karyawan.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Department Overview</CardTitle>
            <CardDescription>Jumlah karyawan per department.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className='space-y-2'>
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className='h-8 w-full' />
                ))}
              </div>
            ) : departments.length === 0 ? (
              <p className='text-muted-foreground text-sm'>Belum ada department.</p>
            ) : (
              <div className='space-y-2'>
                {departments.map((d) => (
                  <div key={d.id} className='flex items-center justify-between text-sm'>
                    <span>{d.name}</span>
                    <span className='tabular-nums font-medium'>{d.employee_count ?? 0}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className='grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4'>
            {QUICK_ACTIONS.map((a) => {
              const Icon = Icons[a.icon];
              return (
                <Link
                  key={a.label}
                  href={a.href}
                  className='border-border hover:bg-muted flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors'
                >
                  <Icon className='size-4' />
                  {a.label}
                </Link>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
