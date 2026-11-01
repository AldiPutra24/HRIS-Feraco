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
  ANNOUNCEMENT_CATEGORY_LABEL,
  createAnnouncement,
  deleteAnnouncement,
  listAnnouncements,
  updateAnnouncement,
  type Announcement,
  type AnnouncementCategory
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
  label,
  allLabel,
  options,
  value,
  onChange
}: {
  label: string;
  allLabel: string;
  options: FilterOption[];
  value: number | null;
  onChange: (id: number | null) => void;
}) {
  const selected = options.find((o) => o.id === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type='button'
            className={cn(
              buttonVariants({ variant: 'ghost' }),
              'max-w-56',
              selected && 'bg-primary/5 text-primary'
            )}
          />
        }
      >
        <span className='truncate'>{selected ? selected.name : label}</span>
        {selected && <Icons.chevronDown className='size-4 shrink-0 opacity-60' />}
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

/** Contracts within this many days are "Segera" (orange); later ones "Pantau". */
const CONTRACT_URGENT_DAYS = 60;

type AnnouncementTab = 'LIVE' | 'DRAFT' | 'ARCHIVE';

const ANNOUNCEMENT_TABS: { value: AnnouncementTab; label: string; empty: string }[] = [
  { value: 'LIVE', label: 'Tayang', empty: 'Belum ada pengumuman' },
  { value: 'DRAFT', label: 'Draf', empty: 'Tidak ada draf' },
  { value: 'ARCHIVE', label: 'Arsip', empty: 'Arsip kosong' }
];

/** Tayang = active & not past its end date; Arsip = past its end date; Draf = inactive otherwise. */
function announcementTab(a: Announcement, todayIso: string): AnnouncementTab {
  if (a.use_end_date && a.end_date && a.end_date < todayIso) return 'ARCHIVE';
  return a.status === 'ACTIVE' ? 'LIVE' : 'DRAFT';
}

function fmtDate(iso: string | null, opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' }): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('id-ID', opts);
}

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

function localIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function Bar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn('bg-muted h-1.5 w-full overflow-hidden rounded-full', className)}>
      <div className='bg-primary h-full rounded-full' style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

function SectionHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className='flex flex-wrap items-start justify-between gap-3 px-5 pt-5 pb-4'>
      <div className='min-w-0'>
        <h3 className='text-base font-semibold'>{title}</h3>
        {description && <p className='text-muted-foreground mt-0.5 text-sm'>{description}</p>}
      </div>
      {action}
    </div>
  );
}

function ArrowLink({ href, onClick, children }: { href?: string; onClick?: () => void; children: ReactNode }) {
  const className = 'text-primary inline-flex w-fit items-center gap-1 text-sm font-semibold hover:underline';
  const content = (
    <>
      {children}
      <Icons.arrowRight className='size-4' />
    </>
  );
  return href ? (
    <Link href={href} className={className}>
      {content}
    </Link>
  ) : (
    <button type='button' onClick={onClick} className={className}>
      {content}
    </button>
  );
}

/** "Perlu tindakan" card: chip, big number + label, detail line and an action link. */
function ActionCard({
  chip,
  chipIcon,
  chipClassName,
  value,
  label,
  detail,
  action,
  loading,
  className
}: {
  chip: string;
  chipIcon: keyof typeof Icons;
  chipClassName?: string;
  value: number;
  label: string;
  detail: string;
  action: ReactNode;
  loading: boolean;
  className?: string;
}) {
  const Icon = Icons[chipIcon];
  return (
    <Card className={cn('gap-3 px-5 py-5', className)}>
      <span
        className={cn(
          'inline-flex w-fit items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium',
          chipClassName ?? 'bg-muted text-foreground'
        )}
      >
        <Icon className='size-3.5' />
        {chip}
      </span>
      {loading ? (
        <Skeleton className='h-14 w-full' />
      ) : (
        <>
          <p className='flex items-baseline gap-2'>
            <span className='text-3xl font-semibold tabular-nums'>{value}</span>
            <span className='text-sm font-medium'>{label}</span>
          </p>
          <p className='text-muted-foreground line-clamp-2 text-sm'>{detail}</p>
        </>
      )}
      {action}
    </Card>
  );
}

function Avatar({ name, photo, size = 'size-9' }: { name: string; photo?: string | null; size?: string }) {
  return photo ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={photo} alt='' className={cn(size, 'shrink-0 rounded-full object-cover')} />
  ) : (
    <span
      className={cn(
        size,
        'bg-muted text-muted-foreground flex shrink-0 items-center justify-center rounded-full text-xs font-semibold'
      )}
    >
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
  const [announcementTabValue, setAnnouncementTabValue] = useState<AnnouncementTab>('LIVE');
  const [offToday, setOffToday] = useState<OffTodayItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [dashLoading, setDashLoading] = useState(true);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');
  const [useEndDate, setUseEndDate] = useState(true);
  const [endDate, setEndDate] = useState('');
  const [category, setCategory] = useState<AnnouncementCategory>('GENERAL');
  const [isPinned, setIsPinned] = useState(false);
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
    setCategory('GENERAL');
    setIsPinned(false);
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
        setLoadedAt(new Date());
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
        end_date: useEndDate && endDate ? endDate : null,
        category,
        is_pinned: isPinned
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
  }, [editing, title, body, status, useEndDate, endDate, category, isPinned]);

  const startEdit = (a: Announcement) => {
    setEditing(a);
    setTitle(a.title);
    setBody(a.body);
    setStatus(a.status);
    setUseEndDate(a.use_end_date);
    setEndDate(a.end_date ?? '');
    setCategory(a.category);
    setIsPinned(a.is_pinned);
  };

  const remove = async (id: number) => {
    await deleteAnnouncement(id);
    setAnnouncements(await listAnnouncements());
  };

  const toggleStatus = async (a: Announcement) => {
    await updateAnnouncement(a.id, { status: a.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' });
    setAnnouncements(await listAnnouncements());
  };

  const todayIso = localIso(new Date());
  const contracts = dashboard?.contracts_ending ?? [];
  const urgentCount = dashboard?.contracts_ending_60d ?? 0;
  const nearest = contracts[0];
  const nearestNames = nearest ? contracts.filter((c) => c.end_date === nearest.end_date).map((c) => c.employee_name) : [];
  const birthdays = dashboard?.birthdays ?? [];
  const offCount = (cat: OffTodayItem['category']) => (offToday ?? []).filter((i) => i.category === cat).length;
  const tabCount = (t: AnnouncementTab) => announcements.filter((a) => announcementTab(a, todayIso) === t).length;
  const liveCount = tabCount('LIVE');
  const visibleAnnouncements = announcements.filter((a) => announcementTab(a, todayIso) === announcementTabValue);
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
  const activePct = summary && summary.total ? Math.round((summary.active / summary.total) * 100) : 0;
  const todayLabel = new Date().toLocaleDateString('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

  return (
    <div className='flex flex-1 flex-col gap-6 p-4 md:p-8'>
      <div className='flex flex-col gap-4 md:flex-row md:items-end md:justify-between'>
        <div>
          <h2 className='text-3xl font-bold tracking-tight'>Overview HR</h2>
          <p className='text-muted-foreground mt-1 flex flex-wrap items-center gap-x-1.5 text-sm'>
            <span>{todayLabel}</span>
            {loadedAt && (
              <>
                <span>·</span>
                <span className='bg-primary size-1.5 rounded-full' />
                <span>
                  Data per{' '}
                  {loadedAt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' })} WIB
                </span>
              </>
            )}
          </p>
          {filterLabel && (
            <p className='text-muted-foreground mt-1 text-sm'>
              Ringkasan untuk <span className='text-foreground font-medium'>{filterLabel}</span>.
            </p>
          )}
        </div>
        <div className='flex flex-wrap items-center gap-1'>
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
              Reset
            </button>
          )}
          <FilterMenu
            label='Departments'
            allLabel='Semua department'
            options={deptOptions}
            value={deptFilter}
            onChange={selectDept}
          />
          <FilterMenu
            label='Positions'
            allLabel={deptFilter === null ? 'Semua position' : 'Semua position di department ini'}
            options={posOptions}
            value={posFilter}
            onChange={setPosFilter}
          />
          <Link href='/dashboard/karyawan?tambah=1' className={cn(buttonVariants({ size: 'lg' }), 'ml-2 h-10 px-4')}>
            <Icons.plus className='size-4' />
            Tambah Karyawan
          </Link>
        </div>
      </div>

      <section className='space-y-3'>
        <h3 className='text-base font-semibold'>Perlu tindakan</h3>
        <div className='grid grid-cols-1 gap-4 md:grid-cols-3'>
          <ActionCard
            chip='Segera'
            chipIcon='warning'
            chipClassName={urgentCount > 0 ? 'bg-orange-500/10 text-orange-700 dark:text-orange-300' : undefined}
            value={urgentCount}
            label='kontrak berakhir ≤ 60 hari'
            detail={
              nearest && nearest.days_left <= CONTRACT_URGENT_DAYS
                ? `Terdekat ${fmtDate(nearest.end_date, { day: 'numeric', month: 'short' })} — ${nearestNames.join(' & ')}`
                : 'Tidak ada kontrak yang berakhir dalam 60 hari'
            }
            action={<ArrowLink href='#kontrak'>Tinjau perpanjangan</ArrowLink>}
            loading={dashLoading}
            className={cn(urgentCount > 0 && 'border-orange-300 dark:border-orange-500/40')}
          />
          <ActionCard
            chip='Hari ini'
            chipIcon='calendar'
            value={offToday?.length ?? 0}
            label='karyawan sedang cuti'
            detail={`${offCount('ANNUAL')} cuti tahunan · ${offCount('SICK')} sakit · ${offCount('OTHER')} lainnya`}
            action={<ArrowLink href='/dashboard/leave'>Lihat jadwal</ArrowLink>}
            loading={offToday === null}
          />
          <ActionCard
            chip='Komunikasi'
            chipIcon='speakerphone'
            value={liveCount}
            label='pengumuman tayang'
            detail={
              birthdays.length === 0
                ? 'Tidak ada ulang tahun dalam 7 hari'
                : `${birthdays.length} ulang tahun dalam 7 hari: ${birthdays.map((b) => b.full_name).join(', ')}`
            }
            action={<ArrowLink onClick={startAdd}>Buat pengumuman</ArrowLink>}
            loading={dashLoading}
            className='border-dashed'
          />
        </div>
      </section>

      <div className='grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]'>
        <div className='flex min-w-0 flex-col gap-5'>
          <Card id='kontrak' className='scroll-mt-20 gap-0 py-0'>
            <SectionHeader
              title='Kontrak akan berakhir'
              description={`${contracts.length} kontrak aktif terdekat, terdekat lebih dulu`}
              action={
                <Link href='/dashboard/karyawan' className='inline-flex shrink-0 items-center gap-1 text-sm font-semibold hover:underline'>
                  Semua kontrak
                  <Icons.arrowRight className='size-4' />
                </Link>
              }
            />
            {dashLoading ? (
              <div className='space-y-3 border-t px-5 py-4'>
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className='h-12 w-full' />
                ))}
              </div>
            ) : contracts.length === 0 ? (
              <p className='text-muted-foreground border-t px-5 py-10 text-center text-sm'>
                Tidak ada kontrak yang akan berakhir
              </p>
            ) : (
              <ul className='divide-y border-t'>
                {contracts.map((c) => {
                  const urgent = c.days_left <= CONTRACT_URGENT_DAYS;
                  return (
                    <li key={c.id} className='flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5'>
                      <div className='flex min-w-0 flex-1 items-center gap-3'>
                        <Avatar name={c.employee_name} />
                        <div className='min-w-0'>
                          <p className='truncate text-sm font-medium'>{c.employee_name}</p>
                          <p className='text-muted-foreground truncate text-xs'>{c.position_name || '—'}</p>
                        </div>
                      </div>
                      <span className='text-sm tabular-nums sm:w-28'>{fmtDate(c.end_date)}</span>
                      <span
                        className={cn(
                          'inline-flex w-36 items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap',
                          urgent
                            ? 'bg-orange-500/10 text-orange-700 dark:text-orange-300'
                            : 'bg-muted text-muted-foreground'
                        )}
                      >
                        <span className='tabular-nums'>{c.days_left} hari</span>·<span>{urgent ? 'Segera' : 'Pantau'}</span>
                      </span>
                      <Link
                        href={`/dashboard/karyawan/${c.employee_pk}`}
                        className={buttonVariants({ variant: 'outline', size: 'sm' })}
                      >
                        Tinjau
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card id='pengumuman' className='gap-0 py-0'>
            <SectionHeader
              title='Pengumuman'
              description='Tampil di dashboard karyawan sesuai target penerima'
              action={
                <button type='button' onClick={startAdd} className={buttonVariants({ variant: 'outline' })}>
                  <Icons.plus className='size-4' />
                  Buat pengumuman
                </button>
              }
            />
            <div className='flex flex-wrap gap-2 px-5 pb-4'>
              {ANNOUNCEMENT_TABS.map((t) => (
                <button
                  key={t.value}
                  type='button'
                  onClick={() => setAnnouncementTabValue(t.value)}
                  className={cn(
                    'rounded-lg border px-3.5 py-1.5 text-sm transition-colors',
                    announcementTabValue === t.value
                      ? 'bg-foreground text-background border-foreground font-medium'
                      : 'hover:bg-muted'
                  )}
                >
                  {t.label} · {tabCount(t.value)}
                </button>
              ))}
            </div>
            <div className='border-t'>
              {visibleAnnouncements.length === 0 ? (
                <div className='px-5 py-10 text-center'>
                  <p className='text-sm font-semibold'>
                    {ANNOUNCEMENT_TABS.find((t) => t.value === announcementTabValue)?.empty}
                  </p>
                  {announcementTabValue === 'LIVE' && (
                    <p className='text-muted-foreground mx-auto mt-1 max-w-sm text-sm'>
                      Klik &ldquo;Buat pengumuman&rdquo; untuk menulis yang pertama. Karyawan akan melihatnya di
                      dashboard mereka.
                    </p>
                  )}
                </div>
              ) : (
                <ul className='max-h-80 divide-y overflow-y-auto'>
                  {visibleAnnouncements.map((a) => (
                    <li key={a.id} className='flex items-start justify-between gap-3 px-5 py-3.5'>
                      <div className='min-w-0'>
                        <p className='flex items-center gap-1.5 truncate text-sm font-medium'>
                          {a.is_pinned && <Icons.pin className='size-3.5 shrink-0 text-orange-600' aria-label='Disematkan' />}
                          {a.title}
                        </p>
                        <p className='text-muted-foreground line-clamp-1 text-sm'>{a.body}</p>
                        <p className='text-muted-foreground mt-0.5 text-xs'>
                          {ANNOUNCEMENT_CATEGORY_LABEL[a.category]} · Dibuat {fmtDate(a.created_at)}
                          {a.use_end_date && a.end_date ? ` · berakhir ${fmtDate(a.end_date)}` : ''}
                        </p>
                      </div>
                      <div className='flex shrink-0'>
                        {announcementTabValue !== 'ARCHIVE' && (
                          <button
                            type='button'
                            onClick={() => toggleStatus(a)}
                            className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
                            aria-label={a.status === 'ACTIVE' ? 'Jadikan draf' : 'Tayangkan'}
                            title={a.status === 'ACTIVE' ? 'Jadikan draf' : 'Tayangkan'}
                          >
                            {a.status === 'ACTIVE' ? <Icons.eyeOff className='size-4' /> : <Icons.eye className='size-4' />}
                          </button>
                        )}
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

          <Card className='gap-0 py-0'>
            <SectionHeader
              title='Karyawan terbaru'
              description='5 data terakhir ditambahkan'
              action={
                <Link href='/dashboard/karyawan' className='inline-flex shrink-0 items-center gap-1 text-sm font-semibold hover:underline'>
                  Semua karyawan
                  <Icons.arrowRight className='size-4' />
                </Link>
              }
            />
            {loading ? (
              <div className='space-y-2 px-5 pb-5'>
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className='h-10 w-full' />
                ))}
              </div>
            ) : (
              <Table>
                <TableHeader className='bg-muted/40'>
                  <TableRow>
                    <TableHead className='pl-5'>Nama</TableHead>
                    <TableHead>Position</TableHead>
                    <TableHead>Atasan</TableHead>
                    <TableHead className='pr-5'>Bergabung</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {employees.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className='py-3 pl-5'>
                        <Link href={`/dashboard/karyawan/${e.id}`} className='flex items-center gap-3 hover:underline'>
                          <Avatar name={e.full_name} photo={e.photo_url} />
                          <span className='min-w-0'>
                            <span className='block font-medium'>{e.full_name}</span>
                            <span className='text-muted-foreground block font-mono text-xs'>{e.employee_id}</span>
                          </span>
                        </Link>
                      </TableCell>
                      <TableCell>
                        <p>{e.position_name || '—'}</p>
                        <p className='text-muted-foreground text-xs'>{e.department_name || '—'}</p>
                      </TableCell>
                      <TableCell>{e.manager_name || '—'}</TableCell>
                      <TableCell className='pr-5 tabular-nums'>{fmtDate(e.join_date)}</TableCell>
                    </TableRow>
                  ))}
                  {employees.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className='text-muted-foreground py-8 text-center'>
                        Tidak ada data karyawan.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </Card>
        </div>

        <div className='flex min-w-0 flex-col gap-5'>
          <Card className='gap-0 py-0'>
            <SectionHeader title='Tenaga kerja' />
            <div className='px-5 pb-5'>
              {loading || !summary ? (
                <Skeleton className='h-20 w-full' />
              ) : (
                <>
                  <div className='grid grid-cols-3 gap-2'>
                    {[
                      { value: summary.total, label: 'Karyawan' },
                      { value: departments.length, label: 'Department' },
                      { value: positions.length, label: 'Position' }
                    ].map((s) => (
                      <div key={s.label}>
                        <p className='text-2xl font-semibold tabular-nums'>{s.value}</p>
                        <p className='text-muted-foreground text-xs'>{s.label}</p>
                      </div>
                    ))}
                  </div>
                  <Bar value={activePct} className='mt-4 h-2' />
                  <p className='text-muted-foreground mt-2 text-xs'>
                    {summary.active} aktif ({activePct}%) · {summary.inactive} nonaktif
                  </p>
                </>
              )}
            </div>
            <div className='border-t px-5 pt-4 pb-5'>
              <p className='mb-3 text-sm font-semibold'>Per department</p>
              {deptRows.length === 0 ? (
                <p className='text-muted-foreground text-sm'>Belum ada department.</p>
              ) : (
                <div className='space-y-2.5'>
                  {deptRows.map((d) => {
                    const n = d.employee_count ?? 0;
                    const dimmed = deptFilter !== null && d.id !== deptFilter;
                    return (
                      <button
                        key={d.id}
                        type='button'
                        onClick={() => selectDept(d.id === deptFilter ? null : d.id)}
                        title={d.id === deptFilter ? 'Hapus filter' : `Filter: ${d.name}`}
                        className={cn(
                          'grid w-full grid-cols-[minmax(0,1fr)_96px_28px] items-center gap-3 text-left text-sm transition-opacity hover:opacity-80',
                          n === 0 && 'text-muted-foreground',
                          dimmed && 'opacity-40'
                        )}
                      >
                        <span className='truncate'>{d.name}</span>
                        <Bar value={(n / deptMax) * 100} />
                        <span className='text-right font-medium tabular-nums'>{n}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </Card>

          <WhosOffToday
            href='/dashboard/leave'
            description='Izin & cuti yang disetujui'
            scope={{ department: deptFilter, position: posFilter }}
            onLoaded={setOffToday}
          />

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
                Kategori
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as AnnouncementCategory)}
                  className='border-border rounded-lg border px-2 py-1 text-sm'
                >
                  {(Object.keys(ANNOUNCEMENT_CATEGORY_LABEL) as AnnouncementCategory[]).map((c) => (
                    <option key={c} value={c}>
                      {ANNOUNCEMENT_CATEGORY_LABEL[c]}
                    </option>
                  ))}
                </select>
              </label>
              <div className='flex items-center gap-2 text-sm'>
                <Switch checked={isPinned} onCheckedChange={setIsPinned} />
                <span>Sematkan di atas</span>
              </div>
            </div>
            <div className='flex flex-wrap items-center gap-3'>
              <label className='flex items-center gap-2 text-sm'>
                Status
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as 'ACTIVE' | 'INACTIVE')}
                  className='border-border rounded-lg border px-2 py-1 text-sm'
                >
                  <option value='ACTIVE'>Tayang</option>
                  <option value='INACTIVE'>Draf</option>
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
