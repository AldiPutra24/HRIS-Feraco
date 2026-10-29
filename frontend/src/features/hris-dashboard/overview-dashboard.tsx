'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';
import {
  listDepartments,
  listEmployees,
  listPositions,
  type Department,
  type Employee,
  type Position
} from '@/lib/employees';
import { getHrDashboard, type HrDashboard } from '@/lib/dashboard';
import type { OffTodayItem } from '@/lib/leaves';
import { WhosOffToday } from '@/features/leaves/whos-off-today';
import {
  createAnnouncement,
  deleteAnnouncement,
  listAnnouncements,
  updateAnnouncement,
  type Announcement
} from '@/lib/announcements';
import { RecentActivities } from '@/features/hris-dashboard/components/recent-activities';

/** Employee counts for the current department/position filter. */
type Summary = {
  total: number;
  active: number;
  inactive: number;
};

type FilterOption = { id: number; name: string; hint?: string };

/** Header dropdown that filters the overview (not a link to the settings page). */
function FilterMenu({
  icon,
  label,
  allLabel,
  options,
  value,
  onChange
}: {
  icon: keyof typeof Icons;
  label: string;
  allLabel: string;
  options: FilterOption[];
  value: number | null;
  onChange: (id: number | null) => void;
}) {
  const Icon = Icons[icon];
  const selected = options.find((o) => o.id === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type='button'
            className={cn(
              buttonVariants({ variant: 'outline' }),
              'max-w-56',
              selected && 'border-primary/40 bg-primary/5 text-primary'
            )}
          />
        }
      >
        <Icon className='size-4 shrink-0' />
        <span className='truncate'>{selected ? selected.name : label}</span>
        <Icons.chevronDown className='size-4 shrink-0 opacity-60' />
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='max-h-80 w-64'>
        <DropdownMenuRadioGroup
          value={value === null ? '' : String(value)}
          onValueChange={(v) => onChange(v ? Number(v) : null)}
        >
          <DropdownMenuRadioItem value=''>{allLabel}</DropdownMenuRadioItem>
          <DropdownMenuSeparator />
          {options.length === 0 ? (
            <p className='text-muted-foreground px-2 py-1.5 text-sm'>Tidak ada pilihan.</p>
          ) : (
            options.map((o) => (
              <DropdownMenuRadioItem key={o.id} value={String(o.id)}>
                <span className='min-w-0 truncate'>
                  {o.name}
                  {o.hint && <span className='text-muted-foreground'> · {o.hint}</span>}
                </span>
              </DropdownMenuRadioItem>
            ))
          )}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Contracts within this many days get the "urgent" (orange) treatment. */
const CONTRACT_URGENT_DAYS = 45;
/** Contract progress bar scale: a full bar = this many days left. */
const CONTRACT_BAR_DAYS = 120;

function fmtDate(iso: string, opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' }): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('id-ID', opts);
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 11) return 'Selamat pagi';
  if (h < 15) return 'Selamat siang';
  if (h < 19) return 'Selamat sore';
  return 'Selamat malam';
}

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

function Bar({ value, className }: { value: number; className?: string }) {
  return (
    <div className='bg-muted h-1.5 w-full overflow-hidden rounded-full'>
      <div
        className={cn('h-full rounded-full', className ?? 'bg-primary')}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

function StatCard({
  label,
  icon,
  loading,
  children
}: {
  label: string;
  icon: keyof typeof Icons;
  loading: boolean;
  children: ReactNode;
}) {
  const Icon = Icons[icon];
  return (
    <Card className='gap-3 px-5 py-5'>
      <div className='text-muted-foreground flex items-center justify-between text-sm'>
        <span>{label}</span>
        <Icon className='size-5' />
      </div>
      {loading ? <Skeleton className='h-16 w-full' /> : children}
    </Card>
  );
}

function SectionHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className='flex items-start justify-between gap-2 px-5 pt-5 pb-4'>
      <div className='min-w-0'>
        <h3 className='text-base font-semibold'>{title}</h3>
        {description && <p className='text-muted-foreground text-sm'>{description}</p>}
      </div>
      {action}
    </div>
  );
}

function Avatar({ name, photo }: { name: string; photo?: string | null }) {
  return photo ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={photo} alt='' className='size-8 shrink-0 rounded-full object-cover' />
  ) : (
    <span className='bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold'>
      {initials(name)}
    </span>
  );
}

export function OverviewDashboard() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [deptFilter, setDeptFilter] = useState<number | null>(null);
  const [posFilter, setPosFilter] = useState<number | null>(null);
  const [dashboard, setDashboard] = useState<HrDashboard | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [offToday, setOffToday] = useState<OffTodayItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [dashLoading, setDashLoading] = useState(true);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');
  const [useEndDate, setUseEndDate] = useState(true);
  const [endDate, setEndDate] = useState('');
  const [saving, setSaving] = useState(false);

  const defaultEndDate = () => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  };

  const resetForm = () => {
    setEditing(null);
    setAdding(false);
    setTitle('');
    setBody('');
    setStatus('ACTIVE');
    setUseEndDate(true);
    setEndDate('');
  };

  const startAdd = () => {
    resetForm();
    setEndDate(defaultEndDate());
    setAdding(true);
  };

  // Filter options + announcements: loaded once, independent of the filter.
  useEffect(() => {
    listDepartments().then(setDepartments).catch(() => {});
    listPositions().then(setPositions).catch(() => {});
    listAnnouncements().then(setAnnouncements).catch(() => {});
  }, []);

  // Employee-scoped widgets follow the department/position filter.
  useEffect(() => {
    let cancelled = false;
    const filter = { department: deptFilter ?? undefined, position: posFilter ?? undefined };
    setLoading(true);
    setDashLoading(true);
    setOffToday(null);
    (async () => {
      try {
        const [latest, active, inactive] = await Promise.all([
          listEmployees({ ordering: '-created_at', ...filter }),
          listEmployees({ employment_status: 'ACTIVE', ...filter }),
          listEmployees({ employment_status: 'INACTIVE', ...filter })
        ]);
        if (cancelled) return;
        setSummary({ total: latest.count, active: active.count, inactive: inactive.count });
        setEmployees(latest.results.slice(0, 5));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    (async () => {
      try {
        const d = await getHrDashboard({ department: deptFilter, position: posFilter });
        if (!cancelled) setDashboard(d);
      } catch {
        // Non-HR roles may lack dashboard access; ignore.
      } finally {
        if (!cancelled) setDashLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deptFilter, posFilter]);

  const selectDept = (id: number | null) => {
    setDeptFilter(id);
    // Drop a position that doesn't belong to the newly selected department.
    if (id !== null && posFilter !== null && positions.find((p) => p.id === posFilter)?.department !== id) {
      setPosFilter(null);
    }
  };

  const saveAnnouncement = useCallback(async () => {
    if (!title.trim() || !body.trim()) return;
    setSaving(true);
    try {
      const payload = {
        title,
        body,
        status,
        use_end_date: useEndDate,
        end_date: useEndDate && endDate ? endDate : null
      };
      if (editing) {
        await updateAnnouncement(editing.id, payload);
      } else {
        await createAnnouncement(payload);
      }
      setAnnouncements(await listAnnouncements());
      resetForm();
    } finally {
      setSaving(false);
    }
  }, [editing, title, body, status, useEndDate, endDate]);

  const startEdit = (a: Announcement) => {
    setEditing(a);
    setTitle(a.title);
    setBody(a.body);
    setStatus(a.status);
    setUseEndDate(a.use_end_date);
    setEndDate(a.end_date ?? '');
  };

  const remove = async (id: number) => {
    await deleteAnnouncement(id);
    setAnnouncements(await listAnnouncements());
  };

  const toggleStatus = async (a: Announcement) => {
    await updateAnnouncement(a.id, { status: a.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' });
    setAnnouncements(await listAnnouncements());
  };

  const contracts = dashboard?.contracts_ending ?? [];
  const birthdays = dashboard?.birthdays ?? [];
  const nearest = contracts[0];
  const offCount = (cat: OffTodayItem['category']) => (offToday ?? []).filter((i) => i.category === cat).length;
  const deptOptions: FilterOption[] = [...departments]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((d) => ({ id: d.id, name: d.name }));
  const posOptions: FilterOption[] = positions
    .filter((p) => deptFilter === null || p.department === deptFilter)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => ({ id: p.id, name: p.name, hint: deptFilter === null ? p.department_name || undefined : undefined }));
  const filterLabel = [
    departments.find((d) => d.id === deptFilter)?.name,
    positions.find((p) => p.id === posFilter)?.name
  ]
    .filter(Boolean)
    .join(' · ');
  const deptRows = [...departments].sort((a, b) => (b.employee_count ?? 0) - (a.employee_count ?? 0));
  const deptMax = Math.max(1, ...deptRows.map((d) => d.employee_count ?? 0));
  const deptTotal = deptRows.reduce((s, d) => s + (d.employee_count ?? 0), 0);
  const todayLabel = new Date().toLocaleDateString('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

  return (
    <div className='flex flex-1 flex-col gap-5 p-4 md:p-6'>
      <div className='flex flex-col gap-4 md:flex-row md:items-end md:justify-between'>
        <div>
          <p className='text-muted-foreground font-mono text-xs tracking-widest uppercase'>{todayLabel}</p>
          <h2 className='mt-1 text-3xl font-bold tracking-tight'>{greeting()}</h2>
          <p className='text-muted-foreground text-sm'>
            {filterLabel ? (
              <>
                Ringkasan untuk <span className='text-foreground font-medium'>{filterLabel}</span>.
              </>
            ) : (
              'Ringkasan operasional HRIS Feraco hari ini.'
            )}
          </p>
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          {(deptFilter !== null || posFilter !== null) && (
            <button
              type='button'
              onClick={() => {
                setDeptFilter(null);
                setPosFilter(null);
              }}
              className={buttonVariants({ variant: 'ghost' })}
            >
              <Icons.close className='size-4' />
              Reset filter
            </button>
          )}
          <FilterMenu
            icon='building'
            label='Departments'
            allLabel='Semua department'
            options={deptOptions}
            value={deptFilter}
            onChange={selectDept}
          />
          <FilterMenu
            icon='briefcase'
            label='Positions'
            allLabel={deptFilter === null ? 'Semua position' : 'Semua position di department ini'}
            options={posOptions}
            value={posFilter}
            onChange={setPosFilter}
          />
        </div>
      </div>

      <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4'>
        <StatCard label='Total Karyawan' icon='teams' loading={loading || !summary}>
          <p className='text-4xl font-semibold tabular-nums'>{summary?.total ?? 0}</p>
          <Bar value={summary && summary.total ? (summary.active / summary.total) * 100 : 0} />
          <div className='text-muted-foreground flex items-center gap-4 text-xs'>
            <span className='flex items-center gap-1.5'>
              <span className='bg-primary size-2 rounded-sm' />
              {summary?.active ?? 0} aktif
            </span>
            <span className='flex items-center gap-1.5'>
              <span className='bg-muted-foreground/40 size-2 rounded-sm' />
              {summary?.inactive ?? 0} nonaktif
            </span>
          </div>
        </StatCard>

        <StatCard label='Sedang Cuti Hari Ini' icon='leave' loading={offToday === null}>
          <p className='text-4xl font-semibold tabular-nums'>
            {offToday?.length ?? 0}{' '}
            <span className='text-muted-foreground text-sm font-normal'>dari {summary?.active ?? '-'} karyawan</span>
          </p>
          <p className='text-muted-foreground text-xs'>
            {offCount('ANNUAL')} cuti tahunan · {offCount('SICK')} sakit · {offCount('OTHER')} lainnya
          </p>
        </StatCard>

        <StatCard label='Kontrak Akan Berakhir' icon='page' loading={dashLoading}>
          <p className='text-4xl font-semibold tabular-nums'>{contracts.length}</p>
          {nearest ? (
            <span
              className={cn(
                'w-fit rounded-md px-2 py-1 text-xs font-medium',
                nearest.days_left <= CONTRACT_URGENT_DAYS
                  ? 'bg-orange-500/10 text-orange-700 dark:text-orange-300'
                  : 'bg-muted text-muted-foreground'
              )}
            >
              Terdekat {fmtDate(nearest.end_date, { day: 'numeric', month: 'short' })} · {nearest.days_left} hari lagi
            </span>
          ) : (
            <p className='text-muted-foreground text-xs'>Tidak ada kontrak yang akan berakhir</p>
          )}
        </StatCard>

        <StatCard label='Struktur Organisasi' icon='hierarchy' loading={departments.length === 0 && positions.length === 0}>
          <div className='flex items-stretch gap-6'>
            <div>
              <p className='text-4xl font-semibold tabular-nums'>{departments.length}</p>
              <p className='text-muted-foreground text-xs'>Department</p>
            </div>
            <div className='border-l pl-6'>
              <p className='text-4xl font-semibold tabular-nums'>{positions.length}</p>
              <p className='text-muted-foreground text-xs'>Position</p>
            </div>
          </div>
        </StatCard>
      </div>

      <div className='grid grid-cols-1 gap-4 lg:grid-cols-3'>
        <div className='flex flex-col gap-4 lg:col-span-2'>
          <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
            <WhosOffToday
              href='/dashboard/leave'
              scope={{ department: deptFilter, position: posFilter }}
              onLoaded={setOffToday}
            />

            <Card className='gap-0 py-0'>
              <SectionHeader
                title='Kontrak Berakhir'
                description='Urut dari yang paling dekat'
                action={
                  <span className='bg-muted rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums'>
                    {contracts.length}
                  </span>
                }
              />
              {dashLoading ? (
                <div className='space-y-3 px-5 pb-5'>
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className='h-12 w-full' />
                  ))}
                </div>
              ) : contracts.length === 0 ? (
                <p className='text-muted-foreground border-t px-5 py-8 text-center text-sm'>
                  Tidak ada kontrak yang akan berakhir
                </p>
              ) : (
                <ul className='divide-y border-t px-5'>
                  {contracts.map((c) => {
                    const urgent = c.days_left <= CONTRACT_URGENT_DAYS;
                    return (
                      <li key={c.id}>
                        <Link href='/dashboard/karyawan' className='block space-y-2 py-3.5 hover:opacity-80'>
                          <div className='flex items-start justify-between gap-2'>
                            <div className='min-w-0'>
                              <p className='truncate text-sm font-medium'>{c.employee_name}</p>
                              <p className='text-muted-foreground truncate text-xs'>
                                {c.position_name || '-'} · {fmtDate(c.end_date)}
                              </p>
                            </div>
                            <span
                              className={cn(
                                'shrink-0 rounded-md px-2 py-0.5 text-xs font-medium tabular-nums',
                                urgent
                                  ? 'bg-orange-500/10 text-orange-700 dark:text-orange-300'
                                  : 'bg-muted text-muted-foreground'
                              )}
                            >
                              {c.days_left} hari
                            </span>
                          </div>
                          <Bar
                            value={(c.days_left / CONTRACT_BAR_DAYS) * 100}
                            className={urgent ? 'bg-orange-500' : 'bg-muted-foreground/50'}
                          />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </div>

          <Card className='gap-0 py-0'>
            <SectionHeader
              title='Karyawan Terbaru'
              description='5 karyawan yang terakhir ditambahkan'
              action={
                <Link
                  href='/dashboard/karyawan'
                  className='inline-flex shrink-0 items-center gap-1 text-sm font-medium hover:underline'
                >
                  Lihat semua karyawan
                  <Icons.arrowRight className='size-4' />
                </Link>
              }
            />
            {loading ? (
              <div className='space-y-2 px-5 pb-5'>
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className='h-8 w-full' />
                ))}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className='pl-5'>Nama</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Position</TableHead>
                    <TableHead>Atasan</TableHead>
                    <TableHead className='pr-5 text-right'>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {employees.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className='pl-5'>
                        <div className='flex items-center gap-3'>
                          <Avatar name={e.full_name} photo={e.photo_url} />
                          <span className='font-medium'>{e.full_name}</span>
                        </div>
                      </TableCell>
                      <TableCell>{e.department_name || '—'}</TableCell>
                      <TableCell>{e.position_name || '—'}</TableCell>
                      <TableCell>{e.manager_name || '—'}</TableCell>
                      <TableCell className='pr-5 text-right'>
                        {e.employment_status === 'ACTIVE' ? (
                          <span className='bg-primary/10 text-primary inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium'>
                            <span className='bg-primary size-1.5 rounded-full' />
                            Aktif
                          </span>
                        ) : (
                          <span className='bg-muted text-muted-foreground inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium'>
                            <span className='bg-muted-foreground size-1.5 rounded-full' />
                            Nonaktif
                          </span>
                        )}
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
          </Card>
        </div>

        <div className='flex flex-col gap-4'>
          <Card className='gap-0 py-0'>
            <SectionHeader
              title='Karyawan per Department'
              description={`${deptTotal} karyawan di ${deptRows.length} department`}
            />
            {departments.length === 0 && loading ? (
              <div className='space-y-3 px-5 pb-5'>
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className='h-8 w-full' />
                ))}
              </div>
            ) : deptRows.length === 0 ? (
              <p className='text-muted-foreground px-5 pb-5 text-sm'>Belum ada department.</p>
            ) : (
              <div className='space-y-3.5 px-5 pb-5'>
                {deptRows.map((d) => {
                  const n = d.employee_count ?? 0;
                  const dimmed = deptFilter !== null && d.id !== deptFilter;
                  return (
                    <button
                      key={d.id}
                      type='button'
                      onClick={() => selectDept(d.id === deptFilter ? null : d.id)}
                      title={d.id === deptFilter ? 'Hapus filter' : `Filter: ${d.name}`}
                      className={cn('block w-full space-y-1.5 text-left transition-opacity hover:opacity-80', dimmed && 'opacity-40')}
                    >
                      <div className={cn('flex items-center justify-between text-sm', n === 0 && 'text-muted-foreground')}>
                        <span className='truncate'>{d.name}</span>
                        <span className='font-medium tabular-nums'>{n}</span>
                      </div>
                      <Bar value={(n / deptMax) * 100} />
                    </button>
                  );
                })}
              </div>
            )}
          </Card>

          <Card className='gap-0 py-0'>
            <div className='px-5 py-4'>
              <div className='flex items-center gap-3'>
                <span className='bg-muted flex size-10 shrink-0 items-center justify-center rounded-lg'>
                  <Icons.cake className='size-5' />
                </span>
                <div className='min-w-0 flex-1'>
                  <p className='text-sm font-semibold'>Ulang Tahun · 7 Hari</p>
                  <p className='text-muted-foreground truncate text-sm'>
                    {dashLoading
                      ? 'Memuat…'
                      : birthdays.length === 0
                        ? 'Tidak ada ulang tahun minggu ini'
                        : `${birthdays.length} karyawan berulang tahun`}
                  </p>
                </div>
                <span className='bg-muted rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums'>
                  {birthdays.length}
                </span>
              </div>
              {birthdays.length > 0 && (
                <ul className='mt-3 space-y-2 pl-13'>
                  {birthdays.map((b) => (
                    <li key={b.id} className='flex items-center justify-between gap-2 text-sm'>
                      <span className='min-w-0 truncate'>
                        {b.full_name}
                        <span className='text-muted-foreground'> · {b.department_name || '-'}</span>
                      </span>
                      <span className='text-muted-foreground shrink-0 text-xs tabular-nums'>
                        {fmtDate(b.birth_date, { day: 'numeric', month: 'short' })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div id='pengumuman' className='border-t px-5 py-4'>
              <div className='flex items-center gap-3'>
                <span className='bg-muted flex size-10 shrink-0 items-center justify-center rounded-lg'>
                  <Icons.speakerphone className='size-5' />
                </span>
                <div className='min-w-0 flex-1'>
                  <p className='text-sm font-semibold'>Pengumuman</p>
                  <p className='text-muted-foreground truncate text-sm'>
                    {announcements.length === 0
                      ? 'Belum ada pengumuman'
                      : `${announcements.filter((a) => a.status === 'ACTIVE').length} aktif`}
                  </p>
                </div>
                <button type='button' onClick={startAdd} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                  <Icons.add className='size-4' />
                  Buat
                </button>
              </div>
              {announcements.length > 0 && (
                <ul className='mt-3 max-h-64 space-y-2 overflow-y-auto'>
                  {announcements.map((a) => (
                    <li key={a.id} className='flex items-start justify-between gap-2 rounded-lg border px-3 py-2'>
                      <div className={cn('min-w-0', a.status !== 'ACTIVE' && 'opacity-60')}>
                        <p className='truncate text-sm font-medium'>{a.title}</p>
                        <p className='text-muted-foreground line-clamp-1 text-xs'>{a.body}</p>
                        <p className='text-muted-foreground text-[11px]'>
                          {a.status === 'ACTIVE' ? 'Aktif' : 'Nonaktif'}
                          {a.use_end_date && a.end_date ? ` · berakhir ${fmtDate(a.end_date)}` : ''}
                        </p>
                      </div>
                      <div className='flex shrink-0'>
                        <button
                          type='button'
                          onClick={() => toggleStatus(a)}
                          className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
                          aria-label={a.status === 'ACTIVE' ? 'Nonaktifkan' : 'Aktifkan'}
                          title={a.status === 'ACTIVE' ? 'Nonaktifkan' : 'Aktifkan'}
                        >
                          {a.status === 'ACTIVE' ? <Icons.eyeOff className='size-4' /> : <Icons.eye className='size-4' />}
                        </button>
                        <button
                          type='button'
                          onClick={() => startEdit(a)}
                          className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
                          aria-label='Edit'
                          title='Edit'
                        >
                          <Icons.edit className='size-4' />
                        </button>
                        <button
                          type='button'
                          onClick={() => remove(a.id)}
                          className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
                          aria-label='Hapus'
                          title='Hapus'
                        >
                          <Icons.trash className='size-4' />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>

          <RecentActivities activities={dashboard?.recent_activities ?? []} loading={dashLoading} />
        </div>
      </div>

      <Sheet open={adding || editing !== null} onOpenChange={(o) => !o && resetForm()}>
        <SheetContent side='right' className='w-full sm:max-w-md'>
          <SheetHeader>
            <SheetTitle>{editing ? 'Edit Pengumuman' : 'Buat Pengumuman'}</SheetTitle>
            <SheetDescription>Pengumuman aktif tampil di dashboard semua karyawan.</SheetDescription>
          </SheetHeader>
          <div className='space-y-3 px-4'>
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
              rows={5}
              className='border-border w-full rounded-lg border px-3 py-2 text-sm'
            />
            <div className='flex flex-wrap items-center gap-3'>
              <label className='flex items-center gap-2 text-sm'>
                Status
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as 'ACTIVE' | 'INACTIVE')}
                  className='border-border rounded-lg border px-2 py-1 text-sm'
                >
                  <option value='ACTIVE'>ACTIVE</option>
                  <option value='INACTIVE'>INACTIVE</option>
                </select>
              </label>
              <div className='flex items-center gap-2 text-sm'>
                <Switch checked={useEndDate} onCheckedChange={setUseEndDate} />
                <span>Gunakan End Date</span>
              </div>
              {useEndDate && (
                <input
                  type='date'
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className='border-border rounded-lg border px-3 py-1 text-sm'
                />
              )}
            </div>
            <div className='flex gap-2'>
              <button
                type='button'
                onClick={saveAnnouncement}
                disabled={saving || !title.trim() || !body.trim()}
                className={buttonVariants({ size: 'sm' })}
              >
                {saving ? 'Menyimpan...' : editing ? 'Simpan' : 'Tambah'}
              </button>
              <button type='button' onClick={resetForm} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
                Batal
              </button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
