'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Icons } from '@/components/icons';
import { listDepartments, listEmployees, listPositions, type Department, type Employee } from '@/lib/employees';
import { getHrDashboard, type DashboardBirthday, type DashboardContractEnding, type DashboardLeaveToday, type HrDashboard } from '@/lib/dashboard';
import {
  createAnnouncement,
  deleteAnnouncement,
  listAnnouncements,
  updateAnnouncement,
  type Announcement
} from '@/lib/announcements';

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

function fmtDate(iso: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDateTime(iso: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

function ListCard({
  icon,
  label,
  count,
  href,
  loading,
  empty,
  children
}: {
  icon: keyof typeof Icons;
  label: string;
  count: number;
  href: string;
  loading: boolean;
  empty: string;
  children: ReactNode;
}) {
  const Icon = Icons[icon];
  return (
    <Card className='flex flex-col'>
      <CardHeader className='pb-3'>
        <Link href={href} className='flex items-center justify-between gap-2 hover:opacity-80'>
          <div className='flex items-center gap-2 text-muted-foreground'>
            <Icon className='size-4' />
            <span className='text-xs font-medium'>{label}</span>
          </div>
          {loading ? (
            <Skeleton className='h-6 w-8' />
          ) : (
            <span className='bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums'>
              {count}
            </span>
          )}
        </Link>
      </CardHeader>
      <CardContent className='flex-1 pt-0'>
        {loading ? (
          <div className='space-y-2'>
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className='h-12 w-full' />
            ))}
          </div>
        ) : count === 0 ? (
          <p className='text-muted-foreground py-6 text-center text-sm'>{empty}</p>
        ) : (
          <ul className='divide-y'>{children}</ul>
        )}
      </CardContent>
    </Card>
  );
}

function LeaveRow({ item }: { item: DashboardLeaveToday }) {
  const period =
    item.start_date === item.end_date
      ? fmtDate(item.start_date)
      : `${fmtDate(item.start_date)} – ${fmtDate(item.end_date)}`;
  return (
    <li>
      <Link href='/dashboard/leave' className='hover:bg-muted flex items-center justify-between gap-2 px-1 py-2'>
        <div className='min-w-0'>
          <p className='truncate text-sm font-medium'>{item.employee_name}</p>
          <p className='text-muted-foreground truncate text-xs'>
            {item.leave_type_name} · {period}
          </p>
        </div>
        <Badge variant={item.status === 'APPROVED' ? 'default' : 'secondary'} className='shrink-0'>
          {item.status}
        </Badge>
      </Link>
    </li>
  );
}

function ContractRow({ item }: { item: DashboardContractEnding }) {
  return (
    <li>
      <Link href='/dashboard/karyawan' className='hover:bg-muted flex items-center justify-between gap-2 px-1 py-2'>
        <div className='min-w-0'>
          <p className='truncate text-sm font-medium'>{item.employee_name}</p>
          <p className='text-muted-foreground truncate text-xs'>
            {item.position_name || '-'} · {fmtDate(item.end_date)}
          </p>
        </div>
        <span className='text-muted-foreground shrink-0 text-xs tabular-nums'>{item.days_left} hari</span>
      </Link>
    </li>
  );
}

function BirthdayRow({ item }: { item: DashboardBirthday }) {
  return (
    <li>
      <Link href='/dashboard/karyawan' className='hover:bg-muted flex items-center justify-between gap-2 px-1 py-2'>
        <div className='min-w-0'>
          <p className='truncate text-sm font-medium'>{item.full_name}</p>
          <p className='text-muted-foreground truncate text-xs'>{item.department_name || '-'}</p>
        </div>
        <span className='text-muted-foreground shrink-0 text-xs tabular-nums'>{fmtDate(item.birth_date)}</span>
      </Link>
    </li>
  );
}

export function OverviewDashboard() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [dashboard, setDashboard] = useState<HrDashboard | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [dashLoading, setDashLoading] = useState(true);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);

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
    (async () => {
      try {
        const [d, a] = await Promise.all([getHrDashboard(), listAnnouncements()]);
        setDashboard(d);
        setAnnouncements(a);
      } catch {
        // Non-HR roles may lack dashboard access; ignore.
      } finally {
        setDashLoading(false);
      }
    })();
  }, []);

  const saveAnnouncement = useCallback(async () => {
    if (!title.trim() || !body.trim()) return;
    setSaving(true);
    try {
      if (editing) {
        await updateAnnouncement(editing.id, { title, body });
      } else {
        await createAnnouncement({ title, body });
      }
      const a = await listAnnouncements();
      setAnnouncements(a);
      if (dashboard) setDashboard({ ...dashboard, announcements: a.slice(0, 10) });
      setEditing(null);
      setAdding(false);
      setTitle('');
      setBody('');
    } finally {
      setSaving(false);
    }
  }, [editing, adding, title, body, dashboard]);

  const startEdit = (a: Announcement) => {
    setEditing(a);
    setTitle(a.title);
    setBody(a.body);
  };

  const remove = async (id: number) => {
    await deleteAnnouncement(id);
    const a = await listAnnouncements();
    setAnnouncements(a);
    if (dashboard) setDashboard({ ...dashboard, announcements: a.slice(0, 10) });
  };

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

      <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4'>
        <ListCard
          icon='leave'
          label='Izin & Cuti Hari Ini'
          count={dashboard?.leave_today.length ?? 0}
          href='/dashboard/leave'
          loading={dashLoading}
          empty='Tidak ada data hari ini'
        >
          {dashboard?.leave_today.map((item) => <LeaveRow key={item.id} item={item} />)}
        </ListCard>
        <ListCard
          icon='calendar'
          label='End of Contract'
          count={dashboard?.contracts_ending.length ?? 0}
          href='/dashboard/karyawan'
          loading={dashLoading}
          empty='Tidak ada kontrak yang akan berakhir'
        >
          {dashboard?.contracts_ending.map((item) => <ContractRow key={item.id} item={item} />)}
        </ListCard>
        <ListCard
          icon='user'
          label='Birthday 7 Hari'
          count={dashboard?.birthdays.length ?? 0}
          href='/dashboard/karyawan'
          loading={dashLoading}
          empty='Tidak ada ulang tahun dalam 7 hari'
        >
          {dashboard?.birthdays.map((item) => <BirthdayRow key={item.id} item={item} />)}
        </ListCard>
        <ListCard
          icon='notification'
          label='Pengumuman'
          count={announcements.length}
          href='#pengumuman'
          loading={dashLoading}
          empty='Belum ada pengumuman'
        >
          {announcements.map((a) => (
            <li key={a.id}>
              <div className='hover:bg-muted flex items-start justify-between gap-2 px-1 py-2'>
                <div className='min-w-0'>
                  <p className='truncate text-sm font-medium'>{a.title}</p>
                  <p className='text-muted-foreground line-clamp-1 text-xs'>{a.body}</p>
                  <p className='text-muted-foreground mt-0.5 text-[11px]'>
                    {fmtDateTime(a.created_at)}
                    {a.created_by_name ? ` · ${a.created_by_name}` : ''}
                  </p>
                </div>
                <div className='flex shrink-0 gap-1'>
                  <button
                    type='button'
                    onClick={() => startEdit(a)}
                    className={buttonVariants({ variant: 'ghost', size: 'icon' })}
                    aria-label='Edit'
                  >
                    <Icons.edit className='size-4' />
                  </button>
                  <button
                    type='button'
                    onClick={() => remove(a.id)}
                    className={buttonVariants({ variant: 'ghost', size: 'icon' })}
                    aria-label='Hapus'
                  >
                    <Icons.trash className='size-4' />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ListCard>
      </div>

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

      <Card id='pengumuman'>
        <CardHeader>
          <div className='flex items-center justify-between'>
            <CardTitle className='flex items-center gap-2'>
              <Icons.notification className='size-4' />
              Pengumuman
            </CardTitle>
            {!editing && !adding && (
              <button
                type='button'
                onClick={() => {
                  setEditing(null);
                  setTitle('');
                  setBody('');
                  setAdding(true);
                }}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                <Icons.add className='size-4' />
                Baru
              </button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {editing !== null || adding || title || body ? (
            <div className='space-y-2'>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder='Judul pengumuman'
                className='border-border w-full rounded-lg border px-3 py-2 text-sm'
              />
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder='Isi pengumuman'
                rows={3}
                className='border-border w-full rounded-lg border px-3 py-2 text-sm'
              />
              <div className='flex gap-2'>
                <button
                  type='button'
                  onClick={saveAnnouncement}
                  disabled={saving}
                  className={buttonVariants({ size: 'sm' })}
                >
                  {saving ? 'Menyimpan...' : editing ? 'Simpan' : 'Tambah'}
                </button>
                <button
                  type='button'
                  onClick={() => {
                    setEditing(null);
                    setAdding(false);
                    setTitle('');
                    setBody('');
                  }}
                  className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                >
                  Batal
                </button>
              </div>
            </div>
          ) : announcements.length === 0 ? (
            <p className='text-muted-foreground text-sm'>Belum ada pengumuman.</p>
          ) : (
            <div className='space-y-3'>
              {announcements.map((a) => (
                <div key={a.id} className='border-b pb-3 last:border-0 last:pb-0'>
                  <div className='flex items-start justify-between gap-2'>
                    <div>
                      <p className='text-sm font-medium'>{a.title}</p>
                      <p className='text-muted-foreground text-sm'>{a.body}</p>
                    </div>
                    <div className='flex shrink-0 gap-1'>
                      <button
                        type='button'
                        onClick={() => startEdit(a)}
                        className={buttonVariants({ variant: 'ghost', size: 'icon' })}
                        aria-label='Edit'
                      >
                        <Icons.edit className='size-4' />
                      </button>
                      <button
                        type='button'
                        onClick={() => remove(a.id)}
                        className={buttonVariants({ variant: 'ghost', size: 'icon' })}
                        aria-label='Hapus'
                      >
                        <Icons.trash className='size-4' />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

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
