'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Icons } from '@/components/icons';
import { AnnouncementFeed } from '@/features/announcements/announcement-feed';
import { WhosOffToday } from '@/features/leaves/whos-off-today';
import { useAuth } from '@/lib/auth/auth-provider';
import { cn } from '@/lib/utils';
import type { OffTodayItem } from '@/lib/leaves';
import type { AppNotification } from '@/lib/notifications';
import type { CompanyContractEnding, ManagementDashboard } from '@/lib/management';
import {
  ActivityCard,
  ApprovalButton,
  ApprovalItem,
  ArrowLink,
  Bar,
  DashboardHeader,
  HeaderLink,
  Initials,
  StatusPill,
  fmtDate,
  fmtShort,
  pct
} from './overview-parts';

// General Manager dashboard: company-wide, read-only overview (backend
// /dashboard/management/ `company` block). Approvals stay limited to the GM's
// direct reports — "Perlu persetujuan Anda" lists only those.

type ContractWindow = 60 | 90 | 'ALL';

const WINDOWS: { value: ContractWindow; label: string }[] = [
  { value: 60, label: '≤ 60 hari' },
  { value: 90, label: '≤ 90 hari' },
  { value: 'ALL', label: 'Semua' }
];

/** ≤ 60 days red, ≤ 90 amber, later neutral. */
function daysTone(days: number): string {
  if (days <= 60) return 'bg-red-500/10 text-red-700 dark:text-red-300';
  if (days <= 90) return 'bg-amber-500/10 text-amber-700 dark:text-amber-300';
  return 'bg-muted text-muted-foreground';
}

function KpiCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Card className='gap-3 px-5 py-5'>
      <p className='text-muted-foreground text-sm'>{label}</p>
      {children}
    </Card>
  );
}

function ContractRow({ c }: { c: CompanyContractEnding }) {
  const type = c.contract_type === 'PKWT' && c.pkwt_sequence ? `PKWT ${c.pkwt_sequence}` : c.contract_type;
  return (
    <li>
      <Link
        href={`/dashboard/karyawan/${c.employee}`}
        className='hover:bg-muted/50 flex items-center gap-3 px-5 py-3 transition-colors'
      >
        <Initials name={c.employee_name} />
        <div className='min-w-0 flex-1'>
          <p className='truncate text-sm font-medium'>{c.employee_name}</p>
          <p className='text-muted-foreground truncate text-xs'>
            {[c.position_name, c.department_name, type].filter(Boolean).join(' · ')}
          </p>
        </div>
        <span className='hidden text-sm tabular-nums sm:block'>{fmtDate(c.end_date)}</span>
        <span
          className={cn(
            'w-20 shrink-0 rounded-md px-2 py-1 text-center text-xs font-semibold tabular-nums',
            daysTone(c.days_left)
          )}
        >
          {c.days_left} hari
        </span>
      </Link>
    </li>
  );
}

export function GmOverview({
  data,
  notifications,
  fetchedAt,
  reloadKey,
  onRefresh
}: {
  data: ManagementDashboard & { company: NonNullable<ManagementDashboard['company']> };
  notifications: AppNotification[];
  fetchedAt: Date | null;
  reloadKey: number;
  onRefresh: () => void;
}) {
  const { user } = useAuth();
  const { company, leave, pending_leave_items: pending } = data;
  const s = company.summary;
  const [contractWindow, setContractWindow] = useState<ContractWindow>('ALL');
  const [offToday, setOffToday] = useState<OffTodayItem[] | null>(null);

  const contracts = company.contracts_ending.filter((c) => contractWindow === 'ALL' || c.days_left <= contractWindow);
  const nearest = company.contracts_ending[0];
  const deptMax = Math.max(1, ...company.departments.map((d) => d.total));

  return (
    <div className='flex flex-1 flex-col gap-6 p-4 md:p-8'>
      <DashboardHeader
        name={user?.name?.split(' ')[0] ?? ''}
        subtitle='Ringkasan perusahaan secara menyeluruh.'
        fetchedAt={fetchedAt}
        onRefresh={onRefresh}
      >
        <HeaderLink href='/dashboard/karyawan' icon='user'>
          Data Karyawan
        </HeaderLink>
        <HeaderLink href='/dashboard/freelance' icon='freelancer'>
          Freelancer
        </HeaderLink>
        <HeaderLink href='/dashboard/payroll' icon='wallet'>
          Payroll
        </HeaderLink>
        <ApprovalButton count={leave.awaiting_me} />
      </DashboardHeader>

      <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4'>
        <KpiCard label='Total Karyawan'>
          <p className='text-4xl font-semibold tabular-nums'>{s.total_employees}</p>
          <Bar value={pct(s.active_employees, s.total_employees)} className='h-1.5' />
          <div className='text-muted-foreground flex gap-4 text-xs'>
            <span className='flex items-center gap-1.5'>
              <span className='bg-primary size-2 rounded-sm' />
              {s.active_employees} aktif
            </span>
            <span className='flex items-center gap-1.5'>
              <span className='bg-muted-foreground/30 size-2 rounded-sm' />
              {s.inactive_employees} nonaktif
            </span>
          </div>
        </KpiCard>

        <KpiCard label='Struktur Organisasi'>
          <div className='flex items-stretch gap-6'>
            <div>
              <p className='text-4xl font-semibold tabular-nums'>{s.total_departments}</p>
              <p className='text-muted-foreground text-xs'>Department</p>
            </div>
            <div className='border-l pl-6'>
              <p className='text-4xl font-semibold tabular-nums'>{s.total_positions}</p>
              <p className='text-muted-foreground text-xs'>Position</p>
            </div>
          </div>
        </KpiCard>

        <KpiCard label='Kontrak berakhir ≤ 60 hari'>
          <p className='flex items-baseline gap-2'>
            <span className='text-4xl font-semibold tabular-nums'>{company.contracts_ending_60d}</span>
            <span className='text-muted-foreground text-sm'>dari {company.contracts_ending_total} kontrak terpantau</span>
          </p>
          {nearest ? (
            <span className={cn('w-fit rounded-md px-2 py-1 text-xs font-medium', daysTone(nearest.days_left))}>
              Terdekat {fmtShort(nearest.end_date)} · {nearest.days_left} hari lagi
            </span>
          ) : (
            <p className='text-muted-foreground text-xs'>Tidak ada kontrak yang akan berakhir</p>
          )}
        </KpiCard>

        <KpiCard label='Izin & Cuti Organisasi'>
          <p className='flex items-baseline gap-2'>
            <span className='text-4xl font-semibold tabular-nums'>{offToday?.length ?? '–'}</span>
            <span className='text-muted-foreground text-sm'>sedang cuti hari ini</span>
          </p>
          <p className='text-muted-foreground text-xs'>
            {leave.pending} pending · {leave.approved} disetujui · {leave.rejected} ditolak · {leave.cancelled} dibatalkan
          </p>
        </KpiCard>
      </div>

      <div className='grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]'>
        <div className='flex min-w-0 flex-col gap-5'>
          <Card className='gap-0 overflow-hidden py-0'>
            <div className='flex flex-wrap items-start justify-between gap-3 px-5 pt-5 pb-4'>
              <div>
                <h3 className='text-base font-semibold'>Kontrak Akan Berakhir</h3>
                <p className='text-muted-foreground mt-0.5 text-sm'>Kontrak aktif yang paling dekat berakhir</p>
              </div>
              <div className='bg-muted flex rounded-lg p-1' role='group' aria-label='Rentang kontrak'>
                {WINDOWS.map((w) => (
                  <button
                    key={w.label}
                    type='button'
                    onClick={() => setContractWindow(w.value)}
                    aria-pressed={contractWindow === w.value}
                    className={cn(
                      'rounded-md px-3 py-1.5 text-sm transition-colors',
                      contractWindow === w.value
                        ? 'bg-background font-semibold shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {w.label}
                  </button>
                ))}
              </div>
            </div>
            {contracts.length === 0 ? (
              <p className='text-muted-foreground border-t px-5 py-10 text-center text-sm'>
                Tidak ada kontrak yang berakhir dalam rentang ini.
              </p>
            ) : (
              <ul className='divide-y border-t'>
                {contracts.map((c) => (
                  <ContractRow key={c.id} c={c} />
                ))}
              </ul>
            )}
            <div className='text-muted-foreground flex items-center justify-between border-t px-5 py-3.5 text-sm'>
              <span>{contracts.length} kontrak</span>
              <ArrowLink href='/dashboard/karyawan'>Lihat semua</ArrowLink>
            </div>
          </Card>

          <AnnouncementFeed reloadKey={reloadKey} />

          <Card className='gap-0 py-0'>
            <div className='flex items-start justify-between gap-3 px-5 pt-5 pb-4'>
              <div>
                <h3 className='text-base font-semibold'>Karyawan Terbaru</h3>
                <p className='text-muted-foreground mt-0.5 text-sm'>Di seluruh perusahaan</p>
              </div>
              <ArrowLink href='/dashboard/karyawan'>Lihat semua karyawan</ArrowLink>
            </div>
            {company.latest_employees.length === 0 ? (
              <p className='text-muted-foreground border-t px-5 py-8 text-center text-sm'>Belum ada data karyawan.</p>
            ) : (
              <Table>
                <TableHeader className='bg-muted/40'>
                  <TableRow>
                    <TableHead className='pl-5'>Nama</TableHead>
                    <TableHead>Department · Position</TableHead>
                    <TableHead>Atasan</TableHead>
                    <TableHead>Bergabung</TableHead>
                    <TableHead className='pr-5 text-right'>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {company.latest_employees.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className='py-3 pl-5'>
                        <Link href={`/dashboard/karyawan/${e.id}`} className='flex items-center gap-3 hover:underline'>
                          <Initials name={e.full_name} />
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
                      <TableCell className='whitespace-nowrap tabular-nums'>{fmtDate(e.join_date)}</TableCell>
                      <TableCell className='pr-5 text-right'>
                        <StatusPill active={e.employment_status === 'ACTIVE'} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </div>

        <div className='flex min-w-0 flex-col gap-5'>
          <Card className='gap-0 py-0'>
            {pending.length === 0 ? (
              <div className='flex items-start gap-3 px-5 py-5'>
                <span className='bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-xl'>
                  <Icons.check className='size-5' />
                </span>
                <div>
                  <p className='text-sm font-semibold'>Perlu persetujuan Anda</p>
                  <p className='text-muted-foreground text-sm'>Semua pengajuan dari tim langsung sudah ditindaklanjuti.</p>
                </div>
              </div>
            ) : (
              <>
                <div className='flex items-start justify-between gap-2 px-5 pt-5 pb-3'>
                  <div>
                    <p className='text-base font-semibold'>Perlu persetujuan Anda</p>
                    <p className='text-muted-foreground text-sm'>{leave.awaiting_me} pengajuan dari tim langsung</p>
                  </div>
                  <ArrowLink href='/dashboard/management/leave'>Lihat</ArrowLink>
                </div>
                <ul className='divide-y border-t'>
                  {pending.map((l) => (
                    <ApprovalItem key={l.id} leave={l} />
                  ))}
                </ul>
              </>
            )}
          </Card>

          <Card className='gap-0 py-0'>
            <div className='px-5 pt-5 pb-4'>
              <h3 className='text-base font-semibold'>Karyawan per Department</h3>
              <p className='text-muted-foreground mt-0.5 text-sm'>
                {s.total_employees} karyawan di {s.total_departments} department
              </p>
            </div>
            {company.departments.length === 0 ? (
              <p className='text-muted-foreground px-5 pb-5 text-sm'>Belum ada department.</p>
            ) : (
              <ul className='space-y-3.5 px-5 pb-5'>
                {company.departments.map((d) => (
                  <li key={d.id ?? 'none'} className={cn(d.total === 0 && 'text-muted-foreground')}>
                    <div className='mb-1.5 flex items-baseline justify-between gap-2 text-sm'>
                      <span className='truncate'>{d.name}</span>
                      <span className='text-muted-foreground shrink-0 text-xs tabular-nums'>
                        <span className='text-foreground text-sm font-semibold'>{d.total}</span> · {pct(d.total, s.total_employees)}%
                      </span>
                    </div>
                    <Bar value={(d.total / deptMax) * 100} />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <WhosOffToday compact href='/dashboard/management/leave' onLoaded={setOffToday} />

          <ActivityCard notifications={notifications} />
        </div>
      </div>
    </div>
  );
}
