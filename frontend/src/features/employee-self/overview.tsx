'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';
import { WhosOffToday } from '@/features/leaves/whos-off-today';
import { listAnnouncements, type Announcement } from '@/lib/announcements';
import { getUpcomingBirthdays, type UpcomingBirthday } from '@/lib/dashboard';
import { formatDays, getMyBalances, listLeaveRequests, type LeaveRequest, type MyBalance } from '@/lib/leaves';
import { getReimbursementSummary, type ReimbursementSummary } from '@/lib/reimbursements';
import { useMyEmployee } from './use-my-employee';

const LEAVE_NEW = '/dashboard/employee/leave/new';
const LEAVE_HISTORY = '/dashboard/employee/leave';
const REIMBURSEMENT_NEW = '/dashboard/employee/reimbursement/new';
const REIMBURSEMENT_HISTORY = '/dashboard/employee/reimbursement';

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

/** "(TEST) Andi Pratama" -> "Andi". */
function firstName(fullName: string): string {
  return fullName.replace(/\([^)]*\)/g, '').trim().split(/\s+/)[0] || fullName;
}

function initials(name: string): string {
  return name
    .replace(/\([^)]*\)/g, '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

function MiniStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className='bg-muted/40 rounded-lg border px-3 py-2.5'>
      <p className='text-muted-foreground truncate text-xs'>{label}</p>
      <p className='mt-1 text-2xl font-semibold tabular-nums'>{value}</p>
    </div>
  );
}

function InfoRow({ icon, title, subtitle, children }: { icon: keyof typeof Icons; title: string; subtitle: string; children?: ReactNode }) {
  const Icon = Icons[icon];
  return (
    <div className='px-5 py-4'>
      <div className='flex items-center gap-3'>
        <span className='bg-muted flex size-10 shrink-0 items-center justify-center rounded-lg'>
          <Icon className='size-5' />
        </span>
        <div className='min-w-0'>
          <p className='text-sm font-semibold'>{title}</p>
          <p className='text-muted-foreground truncate text-sm'>{subtitle}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

const SHORTCUTS: { label: string; href: string; icon: keyof typeof Icons }[] = [
  { label: 'Profil saya', href: '/dashboard/employee/profile', icon: 'user' },
  { label: 'Riwayat cuti & izin', href: LEAVE_HISTORY, icon: 'calendar' },
  { label: 'Riwayat reimbursement', href: REIMBURSEMENT_HISTORY, icon: 'receipt' }
];

export function EmployeeOverview() {
  const { employee, contracts, loading: profileLoading } = useMyEmployee();
  const [balances, setBalances] = useState<MyBalance[]>([]);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [birthdays, setBirthdays] = useState<UpcomingBirthday[]>([]);
  const [reimbursement, setReimbursement] = useState<ReimbursementSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<Announcement | null>(null);

  const load = useCallback(async () => {
    const [b, r, a, rs, bd] = await Promise.all([
      getMyBalances().catch(() => [] as MyBalance[]),
      listLeaveRequests(),
      listAnnouncements(),
      getReimbursementSummary(true).catch(() => null),
      getUpcomingBirthdays().catch(() => ({ results: [] as UpcomingBirthday[] }))
    ]);
    // HR staff sees all data server-side; scope to own employee when linked.
    const myId = employee?.id ?? null;
    setBalances(b);
    setRequests(myId ? r.filter((x) => x.employee === myId) : r);
    setAnnouncements(a.filter((x) => x.status === 'ACTIVE').slice(0, 3));
    setReimbursement(rs);
    setBirthdays(bd.results);
    setLoading(false);
  }, [employee?.id]);

  useEffect(() => {
    load();
    // Refetch when the tab regains focus so a reimbursement submitted or
    // approved/rejected elsewhere shows up without logout/login.
    const onFocus = () => {
      if (document.visibilityState === 'visible') load();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [load]);

  if (profileLoading || loading || !employee) {
    return (
      <div className='space-y-2 p-4 md:p-6'>
        <Skeleton className='h-8 w-64' />
        <Skeleton className='h-40 w-full' />
      </div>
    );
  }

  const counts = reimbursement?.counts ?? {};
  const leavePending = requests.filter((r) => r.status === 'PENDING').length;
  const reimbursePending = (counts.PENDING ?? 0) + (counts.WAITING_HR_LEAD ?? 0);
  const approved =
    requests.filter((r) => r.status === 'APPROVED').length + (counts.APPROVED ?? 0) + (counts.PAID ?? 0);
  const waiting = leavePending + reimbursePending;
  // Sisa kuota "per hari ini" from the quota engine (Cuti Tahunan first).
  const mainQuota = balances.find((b) => b.leave_type_code === 'ANNUAL') ?? balances[0] ?? null;
  const current = contracts.find((c) => c.is_current) ?? null;
  const accumulation = employee.contract_accumulation;
  const countedContracts = accumulation?.contracts.filter((c) => c.counted !== false).length ?? 0;
  const todayLabel = new Date().toLocaleDateString('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

  return (
    <div className='flex flex-1 flex-col gap-5 p-4 md:p-6'>
      <div className='flex flex-col gap-4 md:flex-row md:items-center md:justify-between'>
        <div className='flex items-center gap-4'>
          {employee.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={employee.photo_url}
              alt={employee.full_name}
              className='ring-background size-16 shrink-0 rounded-full object-cover shadow-sm ring-4'
            />
          ) : (
            <div className='bg-primary/10 text-primary ring-background flex size-16 shrink-0 items-center justify-center rounded-full text-xl font-semibold shadow-sm ring-4'>
              {initials(employee.full_name)}
            </div>
          )}
          <div className='min-w-0'>
            <p className='text-muted-foreground font-mono text-xs tracking-widest uppercase'>{todayLabel}</p>
            <h2 className='text-2xl font-bold tracking-tight md:text-3xl'>
              {greeting()}, {firstName(employee.full_name)}
            </h2>
            <p className='text-muted-foreground truncate text-sm'>
              {[employee.full_name, employee.position_name, employee.department_name].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>
        <div className='flex flex-wrap gap-2'>
          <Link href={REIMBURSEMENT_NEW} className={buttonVariants({ variant: 'outline' })}>
            <Icons.receipt className='size-4' />
            Ajukan Reimbursement
          </Link>
          <Link href={LEAVE_NEW} className={buttonVariants()}>
            <Icons.add className='size-4' />
            Ajukan Cuti / Izin
          </Link>
        </div>
      </div>

      <div className='grid grid-cols-1 gap-4 lg:grid-cols-3'>
        <Card className='bg-primary text-primary-foreground flex flex-col justify-between gap-6 border-0 px-5 py-5 ring-0'>
          <div className='flex items-center justify-between text-sm font-medium'>
            <span>Sisa {mainQuota?.leave_type_name ?? 'Cuti Tahunan'}</span>
            <Icons.calendar className='size-5 opacity-90' />
          </div>
          <p className='text-6xl font-semibold tabular-nums'>
            {mainQuota ? formatDays(mainQuota.remaining_days) : '-'}
            <span className='ml-2 text-xl font-medium'>hari</span>
          </p>
          <div className='flex items-center justify-between gap-2'>
            <span className='text-sm opacity-90'>
              {mainQuota ? `Per ${fmtDate(mainQuota.as_of, { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}
            </span>
            <Link
              href={LEAVE_NEW}
              className='bg-background text-foreground hover:bg-background/90 inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors'
            >
              Ajukan cuti
              <Icons.arrowRight className='size-4' />
            </Link>
          </div>
        </Card>

        <Card className='gap-4 px-5 py-5'>
          <div className='flex items-start justify-between gap-2'>
            <div>
              <h3 className='text-base font-semibold'>Pengajuan Saya</h3>
              <p className='text-muted-foreground text-sm'>Status cuti, izin &amp; reimbursement</p>
            </div>
            <Link href={LEAVE_HISTORY} className='inline-flex shrink-0 items-center gap-1 text-sm font-medium hover:underline'>
              Riwayat
              <Icons.arrowRight className='size-4' />
            </Link>
          </div>
          <div className='grid grid-cols-3 gap-2'>
            <MiniStat label='Cuti/Izin pending' value={leavePending} />
            <MiniStat label='Reimburse pending' value={reimbursement ? reimbursePending : '-'} />
            <MiniStat label='Disetujui' value={approved} />
          </div>
          <p className='text-muted-foreground flex items-center gap-2 text-sm'>
            {waiting === 0 ? (
              <>
                <Icons.check className='size-4 shrink-0 text-emerald-600' />
                Tidak ada pengajuan yang menunggu persetujuan.
              </>
            ) : (
              <>
                <Icons.clock className='size-4 shrink-0 text-amber-600' />
                {waiting} pengajuan menunggu persetujuan.
              </>
            )}
          </p>
        </Card>

        <Card className='gap-4 px-5 py-5'>
          <div className='flex items-center justify-between'>
            <h3 className='text-base font-semibold'>Kontrak Saya</h3>
            <Link href='/dashboard/employee/contract' aria-label='Lihat kontrak' className='text-muted-foreground hover:text-foreground'>
              <Icons.page className='size-5' />
            </Link>
          </div>
          <div className='bg-muted/30 rounded-lg border border-dashed px-4 py-3'>
            <p className='text-muted-foreground text-xs'>Kontrak aktif</p>
            {current ? (
              <>
                <p className='mt-1 font-semibold'>{current.contract_type}</p>
                <p className='text-muted-foreground text-xs'>
                  {current.end_date ? `Sampai ${fmtDate(current.end_date)}` : 'Tanpa tanggal berakhir'}
                  {current.duration_display ? ` · ${current.duration_display}` : ''}
                </p>
              </>
            ) : (
              <>
                <p className='mt-1 font-semibold'>Belum ada data kontrak aktif</p>
                <p className='text-muted-foreground text-xs'>Hubungi HR jika ini tidak sesuai.</p>
              </>
            )}
          </div>
          <div className='flex items-end justify-between gap-2'>
            <div>
              <p className='text-muted-foreground text-xs'>Akumulasi masa kontrak</p>
              <p className='text-3xl font-semibold'>{accumulation?.display || '-'}</p>
            </div>
            {countedContracts > 0 && (
              <span className='bg-muted rounded-full px-2.5 py-1 text-xs font-medium'>{countedContracts} kontrak</span>
            )}
          </div>
        </Card>
      </div>

      <div className='grid grid-cols-1 items-start gap-4 lg:grid-cols-3'>
        <WhosOffToday wide className='lg:col-span-2' description='Rekan kerja yang sedang izin atau cuti hari ini' />

        <div className='flex flex-col gap-4'>
          <Card className='gap-0 divide-y py-0'>
            <InfoRow
              icon='speakerphone'
              title='Pengumuman'
              subtitle={announcements.length === 0 ? 'Belum ada pengumuman' : `${announcements.length} pengumuman terbaru`}
            >
              {announcements.length > 0 && (
                <ul className='mt-3 space-y-1'>
                  {announcements.map((a) => (
                    <li key={a.id}>
                      <button
                        type='button'
                        onClick={() => setDetail(a)}
                        className='hover:bg-muted block w-full rounded-md px-2 py-1.5 text-left'
                      >
                        <p className='truncate text-sm font-medium'>{a.title}</p>
                        <p className='text-muted-foreground text-xs'>{fmtDate(a.created_at)}</p>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </InfoRow>
            <InfoRow
              icon='cake'
              title='Ulang Tahun · 7 Hari'
              subtitle={birthdays.length === 0 ? 'Tidak ada ulang tahun minggu ini' : `${birthdays.length} rekan berulang tahun`}
            >
              {birthdays.length > 0 && (
                <ul className='mt-3 space-y-2'>
                  {birthdays.map((b) => (
                    <li key={b.id} className='flex items-center justify-between gap-2 text-sm'>
                      <span className='min-w-0 truncate'>
                        {b.full_name}
                        <span className='text-muted-foreground'> · {b.department_name || '-'}</span>
                      </span>
                      <span
                        className={cn(
                          'shrink-0 text-xs tabular-nums',
                          b.days_until === 0 ? 'text-primary font-semibold' : 'text-muted-foreground'
                        )}
                      >
                        {b.days_until === 0 ? 'Hari ini 🎉' : fmtDate(b.next_birthday, { day: 'numeric', month: 'short' })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </InfoRow>
          </Card>

          <Card className='gap-1 px-5 py-5'>
            <p className='text-muted-foreground mb-1 text-sm'>Pintasan</p>
            {SHORTCUTS.map((s) => {
              const Icon = Icons[s.icon];
              return (
                <Link
                  key={s.href + s.label}
                  href={s.href}
                  className='hover:bg-muted -mx-2 flex items-center gap-3 rounded-md px-2 py-2.5 text-sm font-medium'
                >
                  <Icon className='size-4 shrink-0' />
                  <span className='flex-1'>{s.label}</span>
                  <Icons.chevronRight className='text-muted-foreground size-4' />
                </Link>
              );
            })}
          </Card>
        </div>
      </div>

      <Sheet open={detail !== null} onOpenChange={(o) => !o && setDetail(null)}>
        <SheetContent side='right' className='w-full sm:max-w-md'>
          <SheetHeader>
            <SheetTitle>{detail?.title}</SheetTitle>
            <SheetDescription>
              Dipublikasikan {detail ? fmtDate(detail.created_at) : ''}
              {detail?.created_by_name ? ` · ${detail.created_by_name}` : ''}
            </SheetDescription>
          </SheetHeader>
          <div className='whitespace-pre-wrap px-4 py-4 text-sm'>{detail?.body}</div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
