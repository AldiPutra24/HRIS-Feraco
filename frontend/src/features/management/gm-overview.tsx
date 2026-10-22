'use client';

import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Icons } from '@/components/icons';
import { useAuth } from '@/lib/auth/auth-provider';
import { cn } from '@/lib/utils';
import { TeamQuotaCard } from './team-quota-card';
import type { Announcement } from '@/lib/announcements';
import type { AppNotification } from '@/lib/notifications';
import type {
  CompanyContractEnding,
  CompanyDepartment,
  ManagementDashboard,
  ManagementPendingLeave
} from '@/lib/management';

// General Manager dashboard: company-wide, read-only overview (backend
// /dashboard/management/ `company` block). Approvals stay limited to the GM's
// direct reports — "Perlu Persetujuan Anda" lists only those.

type IconName = keyof typeof Icons;

function fmtDate(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtShort(iso: string): string {
  return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 11) return 'Selamat pagi';
  if (h < 15) return 'Selamat siang';
  if (h < 18) return 'Selamat sore';
  return 'Selamat malam';
}

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

const TONES = {
  primary: 'bg-primary/10 text-primary',
  emerald: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  slate: 'bg-slate-500/10 text-slate-600 dark:text-slate-400',
  violet: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  sky: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  amber: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  rose: 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
} as const;

type Tone = keyof typeof TONES;

function StatCard({
  label,
  value,
  hint,
  icon,
  tone,
  href
}: {
  label: string;
  value: number;
  hint?: string;
  icon: IconName;
  tone: Tone;
  href?: string;
}) {
  const Icon = Icons[icon];
  const body = (
    <Card className='hover:border-ring/50 h-full gap-0 py-4 transition-all hover:shadow-md'>
      <CardContent className='flex items-start justify-between gap-3 px-4'>
        <div className='min-w-0'>
          <p className='text-muted-foreground text-xs font-medium'>{label}</p>
          <p className='mt-1 text-3xl font-semibold tracking-tight tabular-nums'>{value}</p>
          {hint && <p className='text-muted-foreground mt-0.5 text-xs'>{hint}</p>}
        </div>
        <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl', TONES[tone])}>
          <Icon className='size-5' />
        </span>
      </CardContent>
    </Card>
  );
  return href ? (
    <Link href={href} className='focus-visible:ring-ring rounded-xl focus-visible:ring-2 focus-visible:outline-none'>
      {body}
    </Link>
  ) : (
    body
  );
}

function SeeAll({ href, label = 'Lihat Semua' }: { href: string; label?: string }) {
  return (
    <Link href={href} className='text-primary inline-flex shrink-0 items-center gap-1 text-xs font-medium hover:underline'>
      {label}
      <Icons.arrowRight className='size-3.5' />
    </Link>
  );
}

function EmptyState({ icon, text }: { icon: IconName; text: string }) {
  const Icon = Icons[icon];
  return (
    <div className='flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center'>
      <Icon className='text-muted-foreground/60 size-6' />
      <p className='text-muted-foreground text-sm'>{text}</p>
    </div>
  );
}

/** Active vs inactive ring (pure CSS conic-gradient, theme-aware). */
function WorkforceRing({ active, inactive }: { active: number; inactive: number }) {
  const total = active + inactive;
  const activePct = pct(active, total);
  return (
    <div className='flex items-center gap-5'>
      <div
        className='relative size-32 shrink-0 rounded-full'
        style={{
          background: total
            ? `conic-gradient(rgb(16 185 129) 0 ${activePct}%, rgb(148 163 184 / 0.45) ${activePct}% 100%)`
            : 'rgb(148 163 184 / 0.25)'
        }}
        role='img'
        aria-label={`${activePct}% karyawan aktif`}
      >
        <div className='bg-card absolute inset-3 flex flex-col items-center justify-center rounded-full'>
          <span className='text-2xl font-semibold tabular-nums'>{activePct}%</span>
          <span className='text-muted-foreground text-[11px]'>aktif</span>
        </div>
      </div>
      <div className='flex flex-col gap-3 text-sm'>
        <div className='flex items-center gap-2'>
          <span className='size-2.5 rounded-full bg-emerald-500' />
          <span className='text-muted-foreground'>Aktif</span>
          <span className='ml-auto font-semibold tabular-nums'>{active}</span>
        </div>
        <div className='flex items-center gap-2'>
          <span className='size-2.5 rounded-full bg-slate-400/70' />
          <span className='text-muted-foreground'>Nonaktif</span>
          <span className='ml-auto font-semibold tabular-nums'>{inactive}</span>
        </div>
        <div className='border-t pt-2'>
          <span className='text-muted-foreground text-xs'>Total {total} karyawan</span>
        </div>
      </div>
    </div>
  );
}

function DepartmentBars({ departments, total }: { departments: CompanyDepartment[]; total: number }) {
  const max = Math.max(1, ...departments.map((d) => d.total));
  if (departments.length === 0) return <EmptyState icon='teams' text='Belum ada department.' />;
  return (
    <ul className='flex flex-col gap-3.5'>
      {departments.map((d) => (
        <li key={d.id ?? 'none'}>
          <div className='mb-1.5 flex items-baseline justify-between gap-2 text-sm'>
            <span className='truncate font-medium'>{d.name}</span>
            <span className='text-muted-foreground shrink-0 text-xs tabular-nums'>
              <span className='text-foreground font-semibold'>{d.total}</span> karyawan · {pct(d.total, total)}%
            </span>
          </div>
          {/* Track = largest department; inner split = active vs inactive. */}
          <div className='bg-muted h-2.5 w-full overflow-hidden rounded-full'>
            <div className='flex h-full' style={{ width: `${(d.total / max) * 100}%` }}>
              <div className='h-full bg-emerald-500' style={{ width: `${pct(d.active, d.total)}%` }} />
              <div className='h-full bg-slate-400/60' style={{ width: `${100 - pct(d.active, d.total)}%` }} />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function urgency(days: number): { tone: string; label: string } {
  if (days <= 7) return { tone: TONES.rose, label: days === 0 ? 'Hari ini' : `${days} hari` };
  if (days <= 30) return { tone: TONES.amber, label: `${days} hari` };
  return { tone: TONES.slate, label: `${days} hari` };
}

function ContractItem({ c }: { c: CompanyContractEnding }) {
  const u = urgency(c.days_left);
  const type = c.contract_type === 'PKWT' && c.pkwt_sequence ? `PKWT ${c.pkwt_sequence}` : c.contract_type;
  return (
    <li>
      <Link
        href={`/dashboard/karyawan/${c.employee}`}
        className='hover:bg-muted/60 flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors'
      >
        <span className='bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold'>
          {initials(c.employee_name)}
        </span>
        <div className='min-w-0 flex-1'>
          <p className='truncate text-sm font-medium'>{c.employee_name}</p>
          <p className='text-muted-foreground truncate text-xs'>
            {[c.position_name, c.department_name].filter(Boolean).join(' · ') || '-'} · {type}
          </p>
        </div>
        <div className='flex shrink-0 flex-col items-end gap-1'>
          <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums', u.tone)}>{u.label}</span>
          <span className='text-muted-foreground text-[11px]'>{fmtDate(c.end_date)}</span>
        </div>
      </Link>
    </li>
  );
}

function ApprovalItem({ leave }: { leave: ManagementPendingLeave }) {
  return (
    <li>
      <Link
        href='/dashboard/management/leave'
        className='hover:bg-muted/60 flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors'
      >
        <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-full', TONES.amber)}>
          <Icons.leave className='size-4' />
        </span>
        <div className='min-w-0 flex-1'>
          <p className='truncate text-sm font-medium'>{leave.employee_name}</p>
          <p className='text-muted-foreground truncate text-xs'>
            {leave.leave_type_name} · {fmtShort(leave.start_date)}
            {leave.start_date !== leave.end_date ? ` – ${fmtShort(leave.end_date)}` : ''} ·{' '}
            {String(leave.total_days).replace('.', ',')} hari
          </p>
        </div>
        <Icons.chevronRight className='text-muted-foreground size-4 shrink-0' />
      </Link>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function GmOverview({
  data,
  announcements,
  notifications,
  fetchedAt,
  onRefresh,
  onOpenAnnouncement
}: {
  data: ManagementDashboard & { company: NonNullable<ManagementDashboard['company']> };
  announcements: Announcement[];
  notifications: AppNotification[];
  fetchedAt: Date | null;
  onRefresh: () => void;
  onOpenAnnouncement: (a: Announcement) => void;
}) {
  const { user } = useAuth();
  const { company, leave, pending_leave_items: pending } = data;
  const s = company.summary;
  const firstName = user?.name?.split(' ')[0] ?? '';
  const today = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className='flex flex-1 flex-col gap-5 p-4 md:p-6'>
      {/* Hero */}
      <section className='from-primary/15 via-primary/5 to-background relative overflow-hidden rounded-2xl border bg-gradient-to-br p-5 md:p-6'>
        <div className='bg-primary/10 pointer-events-none absolute -top-16 -right-16 size-56 rounded-full blur-3xl' />
        <div className='relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between'>
          <div>
            <p className='text-muted-foreground text-xs font-medium tracking-wide uppercase'>{today}</p>
            <h2 className='mt-1 text-2xl font-bold tracking-tight md:text-3xl'>
              {greeting()}
              {firstName ? `, ${firstName}` : ''}
            </h2>
            <p className='text-muted-foreground mt-1 text-sm'>
              Ringkasan perusahaan secara menyeluruh
              {fetchedAt && (
                <span className='text-muted-foreground/70'>
                  {' '}
                  · update {fetchedAt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </p>
          </div>
          <div className='flex flex-wrap items-center gap-2'>
            <Link
              href='/dashboard/management/leave'
              className={cn(
                'inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors',
                leave.awaiting_me > 0
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 hover:bg-amber-500/15 dark:text-amber-300'
                  : 'bg-background/70 hover:bg-muted'
              )}
            >
              <Icons.leave className='size-4' />
              {leave.awaiting_me > 0 ? `${leave.awaiting_me} menunggu persetujuan Anda` : 'Tidak ada persetujuan tertunda'}
            </Link>
            <Button variant='outline' size='icon' onClick={onRefresh} aria-label='Muat ulang'>
              <Icons.refresh className='size-4' />
            </Button>
          </div>
        </div>
      </section>

      {/* KPI */}
      <div className='grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5'>
        <StatCard label='Total Karyawan' value={s.total_employees} icon='teams' tone='primary' href='/dashboard/karyawan' />
        <StatCard
          label='Karyawan Aktif'
          value={s.active_employees}
          hint={`${pct(s.active_employees, s.total_employees)}% dari total`}
          icon='circleCheck'
          tone='emerald'
        />
        <StatCard
          label='Karyawan Nonaktif'
          value={s.inactive_employees}
          hint={`${pct(s.inactive_employees, s.total_employees)}% dari total`}
          icon='circleX'
          tone='slate'
        />
        <StatCard label='Total Department' value={s.total_departments} icon='workspace' tone='violet' />
        <StatCard label='Total Position' value={s.total_positions} icon='briefcase' tone='sky' />
      </div>

      {/* Department Overview + Workforce */}
      <div className='grid grid-cols-1 gap-4 lg:grid-cols-3'>
        <Card className='lg:col-span-2'>
          <CardHeader className='flex-row items-start justify-between space-y-0'>
            <div>
              <CardTitle>Department Overview</CardTitle>
              <CardDescription>Sebaran karyawan per department.</CardDescription>
            </div>
            <div className='text-muted-foreground flex items-center gap-3 text-xs'>
              <span className='flex items-center gap-1.5'>
                <span className='size-2 rounded-full bg-emerald-500' />
                Aktif
              </span>
              <span className='flex items-center gap-1.5'>
                <span className='size-2 rounded-full bg-slate-400/70' />
                Nonaktif
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <DepartmentBars departments={company.departments} total={s.total_employees} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Komposisi Karyawan</CardTitle>
            <CardDescription>Status kepegawaian seluruh perusahaan.</CardDescription>
          </CardHeader>
          <CardContent className='flex flex-col gap-5'>
            <WorkforceRing active={s.active_employees} inactive={s.inactive_employees} />
            <div className='grid grid-cols-2 gap-2'>
              <div className='rounded-xl border px-3 py-2.5'>
                <p className='text-muted-foreground text-xs'>Department</p>
                <p className='text-lg font-semibold tabular-nums'>{s.total_departments}</p>
              </div>
              <div className='rounded-xl border px-3 py-2.5'>
                <p className='text-muted-foreground text-xs'>Position</p>
                <p className='text-lg font-semibold tabular-nums'>{s.total_positions}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* End of Contract + Approvals */}
      <div className='grid grid-cols-1 gap-4 lg:grid-cols-2'>
        <Card>
          <CardHeader className='flex-row items-start justify-between space-y-0'>
            <div>
              <CardTitle className='flex items-center gap-2'>
                End of Contract
                {company.contracts_ending_30d > 0 && (
                  <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', TONES.amber)}>
                    {company.contracts_ending_30d} dalam 30 hari
                  </span>
                )}
              </CardTitle>
              <CardDescription>Kontrak aktif yang paling dekat berakhir.</CardDescription>
            </div>
            <SeeAll href='/dashboard/karyawan' />
          </CardHeader>
          <CardContent>
            {company.contracts_ending.length === 0 ? (
              <EmptyState icon='calendar' text='Tidak ada kontrak yang akan berakhir.' />
            ) : (
              <ul className='-mx-2 flex flex-col'>
                {company.contracts_ending.map((c) => (
                  <ContractItem key={c.id} c={c} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className='flex flex-col gap-4'>
          <Card>
            <CardHeader className='flex-row items-start justify-between space-y-0'>
              <div>
                <CardTitle>Perlu Persetujuan Anda</CardTitle>
                <CardDescription>Izin/cuti dari karyawan yang melapor langsung ke Anda.</CardDescription>
              </div>
              {pending.length > 0 && <SeeAll href='/dashboard/management/leave' />}
            </CardHeader>
            <CardContent>
              {pending.length === 0 ? (
                <div className='flex items-center gap-2 rounded-lg border border-dashed px-4 py-5'>
                  <Icons.check className='size-4 text-emerald-600 dark:text-emerald-400' />
                  <p className='text-muted-foreground text-sm'>Semua pengajuan sudah ditindaklanjuti.</p>
                </div>
              ) : (
                <ul className='-mx-2 flex flex-col'>
                  {pending.map((l) => (
                    <ApprovalItem key={l.id} leave={l} />
                  ))}
                  {leave.awaiting_me > pending.length && (
                    <li className='text-muted-foreground px-2 pt-1 text-xs'>
                      +{leave.awaiting_me - pending.length} pengajuan lainnya
                    </li>
                  )}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className='flex-row items-start justify-between space-y-0'>
              <div>
                <CardTitle>Izin & Cuti Organisasi</CardTitle>
                <CardDescription>Seluruh struktur di bawah Anda.</CardDescription>
              </div>
              <SeeAll href='/dashboard/management/leave' label='Lihat' />
            </CardHeader>
            <CardContent>
              <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
                {[
                  { label: 'Pending', value: leave.pending, tone: 'amber' as Tone },
                  { label: 'Disetujui', value: leave.approved, tone: 'emerald' as Tone },
                  { label: 'Ditolak', value: leave.rejected, tone: 'rose' as Tone },
                  { label: 'Dibatalkan', value: leave.cancelled, tone: 'slate' as Tone }
                ].map((row) => (
                  <div key={row.label} className='rounded-xl border px-3 py-2.5'>
                    <p className='text-muted-foreground flex items-center gap-1.5 text-xs'>
                      <span className={cn('size-2 rounded-full', TONES[row.tone])} />
                      {row.label}
                    </p>
                    <p className='text-lg font-semibold tabular-nums'>{row.value}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Employee Overview */}
      <Card>
        <CardHeader className='flex-row items-start justify-between space-y-0'>
          <div>
            <CardTitle>Employee Overview</CardTitle>
            <CardDescription>Karyawan terbaru di seluruh perusahaan.</CardDescription>
          </div>
          <SeeAll href='/dashboard/karyawan' label='Lihat Semua Karyawan' />
        </CardHeader>
        <CardContent className='p-0'>
          {company.latest_employees.length === 0 ? (
            <div className='p-4'>
              <EmptyState icon='employee' text='Belum ada data karyawan.' />
            </div>
          ) : (
            <div className='overflow-x-auto'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className='pl-6'>Nama</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Position</TableHead>
                    <TableHead>Reporting To</TableHead>
                    <TableHead>Bergabung</TableHead>
                    <TableHead className='pr-6 text-right'>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {company.latest_employees.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className='pl-6'>
                        <Link href={`/dashboard/karyawan/${e.id}`} className='flex items-center gap-3 hover:underline'>
                          <span className='bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold'>
                            {initials(e.full_name)}
                          </span>
                          <span className='min-w-0'>
                            <span className='block truncate font-medium'>{e.full_name}</span>
                            <span className='text-muted-foreground block text-xs'>{e.employee_id}</span>
                          </span>
                        </Link>
                      </TableCell>
                      <TableCell>{e.department_name || '-'}</TableCell>
                      <TableCell>{e.position_name || '-'}</TableCell>
                      <TableCell>{e.manager_name || '-'}</TableCell>
                      <TableCell className='whitespace-nowrap'>{fmtDate(e.join_date)}</TableCell>
                      <TableCell className='pr-6 text-right'>
                        <Badge
                          variant='secondary'
                          className={e.employment_status === 'ACTIVE' ? TONES.emerald : TONES.slate}
                        >
                          {e.employment_status === 'ACTIVE' ? 'Aktif' : 'Nonaktif'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sisa kuota cuti — seluruh karyawan aktif */}
      <TeamQuotaCard
        title='Sisa Kuota Cuti Karyawan'
        description='Kuota per hari ini untuk seluruh karyawan aktif (Kuota + Adjustment − Terpakai; Pending belum memotong kuota).'
        emptyText='Tidak ada karyawan aktif.'
      />

      {/* Announcements + activity */}
      <div className='grid grid-cols-1 gap-4 lg:grid-cols-2'>
        <Card>
          <CardHeader>
            <CardTitle className='flex items-center gap-2'>
              <Icons.notification className='size-4' />
              Pengumuman
            </CardTitle>
          </CardHeader>
          <CardContent>
            {announcements.length === 0 ? (
              <EmptyState icon='notification' text='Belum ada pengumuman.' />
            ) : (
              <div className='-mx-2 flex flex-col gap-1'>
                {announcements.map((a) => (
                  <button
                    key={a.id}
                    type='button'
                    onClick={() => onOpenAnnouncement(a)}
                    className='hover:bg-muted/60 flex w-full flex-col items-start rounded-lg px-2 py-2.5 text-left transition-colors'
                  >
                    <div className='flex w-full items-center justify-between gap-2'>
                      <p className='text-sm font-medium'>{a.title}</p>
                      <span className='text-muted-foreground shrink-0 text-xs'>{fmtShort(a.created_at)}</span>
                    </div>
                    <p className='text-muted-foreground line-clamp-2 text-sm'>{a.body}</p>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className='flex items-center gap-2'>
              <Icons.clock className='size-4' />
              Aktivitas Terbaru
            </CardTitle>
          </CardHeader>
          <CardContent>
            {notifications.length === 0 ? (
              <EmptyState icon='clock' text='Belum ada aktivitas terbaru.' />
            ) : (
              <ul className='divide-y'>
                {notifications.map((n) => (
                  <li key={n.id} className='flex items-start gap-3 py-2.5 first:pt-0 last:pb-0'>
                    <span className='bg-muted flex size-8 shrink-0 items-center justify-center rounded-full'>
                      <Icons.notification className='text-muted-foreground size-4' />
                    </span>
                    <div className='min-w-0 flex-1'>
                      <p className='line-clamp-2 text-sm'>{n.message}</p>
                      <p className='text-muted-foreground text-xs'>{fmtShort(n.created_at)}</p>
                    </div>
                    {n.link && (
                      <Link href={n.link} className='text-muted-foreground hover:text-foreground shrink-0 self-center'>
                        <Icons.arrowRight className='size-4' />
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick actions */}
      <div className='grid grid-cols-2 gap-2 md:grid-cols-4'>
        {[
          { href: '/dashboard/karyawan', label: 'Data Karyawan', icon: 'employee' as const },
          { href: '/dashboard/management/leave', label: 'Persetujuan Cuti', icon: 'leave' as const },
          { href: '/dashboard/freelance', label: 'Talent Pool', icon: 'freelancer' as const },
          { href: '/dashboard/payroll', label: 'Payroll', icon: 'wallet' as const }
        ].map((a) => {
          const Icon = Icons[a.icon];
          return (
            <Link
              key={a.href}
              href={a.href}
              className='hover:bg-muted hover:border-ring/50 flex items-center gap-2.5 rounded-xl border px-4 py-3 text-sm font-medium transition-colors'
            >
              <Icon className='text-muted-foreground size-4' />
              {a.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
