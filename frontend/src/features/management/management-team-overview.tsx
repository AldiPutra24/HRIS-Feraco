'use client';

import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Icons } from '@/components/icons';
import { useAuth } from '@/lib/auth/auth-provider';
import { cn } from '@/lib/utils';
import type { Announcement } from '@/lib/announcements';
import type { AppNotification } from '@/lib/notifications';
import type { ManagementDashboard } from '@/lib/management';
import {
  ApprovalItem,
  EmptyState,
  SeeAll,
  StatCard,
  TONES,
  WorkforceRing,
  fmtShort,
  greeting,
  initials,
  pct,
  type Tone
} from './gm-overview';

// Management dashboard (same visual language as the GM overview). Data is the
// manager's direct reports only (backend /dashboard/management/ scope).

export function ManagementTeamOverview({
  data,
  announcements,
  notifications,
  fetchedAt,
  onRefresh,
  onOpenAnnouncement
}: {
  data: ManagementDashboard;
  announcements: Announcement[];
  notifications: AppNotification[];
  fetchedAt: Date | null;
  onRefresh: () => void;
  onOpenAnnouncement: (a: Announcement) => void;
}) {
  const { user } = useAuth();
  const { team, leave, pending_leave_items: pending, team_members: members } = data;
  const firstName = user?.name?.split(' ')[0] ?? '';
  const today = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const maxDept = Math.max(1, ...team.by_department.map((d) => d.count));

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
              Ringkasan tim yang melapor langsung ke Anda
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
      <div className='grid grid-cols-2 gap-3 xl:grid-cols-4'>
        <StatCard label='Total Tim' value={team.total} icon='teams' tone='primary' href='/dashboard/karyawan' />
        <StatCard
          label='Anggota Aktif'
          value={team.active}
          hint={`${pct(team.active, team.total)}% dari tim`}
          icon='circleCheck'
          tone='emerald'
        />
        <StatCard
          label='Menunggu Persetujuan'
          value={leave.awaiting_me}
          hint='Izin/cuti dari tim Anda'
          icon='clock'
          tone='amber'
          href='/dashboard/management/leave'
        />
        <StatCard label='Izin/Cuti Disetujui' value={leave.approved} hint='Total tim' icon='badgeCheck' tone='sky' />
      </div>

      {/* Approvals + team composition */}
      <div className='grid grid-cols-1 gap-4 lg:grid-cols-3'>
        <Card className='lg:col-span-2'>
          <CardHeader className='flex-row items-start justify-between space-y-0'>
            <div>
              <CardTitle>Perlu Persetujuan Anda</CardTitle>
              <CardDescription>Pengajuan izin/cuti terdekat dari tim Anda.</CardDescription>
            </div>
            {pending.length > 0 && <SeeAll href='/dashboard/management/leave' />}
          </CardHeader>
          <CardContent>
            {pending.length === 0 ? (
              <div className='flex items-center gap-2 rounded-lg border border-dashed px-4 py-6'>
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
          <CardHeader>
            <CardTitle>Komposisi Tim</CardTitle>
            <CardDescription>Status kepegawaian anggota tim.</CardDescription>
          </CardHeader>
          <CardContent className='flex flex-col gap-5'>
            <WorkforceRing active={team.active} inactive={team.inactive} />
            {team.by_department.length > 1 && (
              <ul className='flex flex-col gap-2.5'>
                {team.by_department.map((d) => (
                  <li key={d.department ?? 'none'}>
                    <div className='mb-1 flex items-baseline justify-between gap-2 text-xs'>
                      <span className='truncate font-medium'>{d.department_name}</span>
                      <span className='text-muted-foreground tabular-nums'>{d.count}</span>
                    </div>
                    <div className='bg-muted h-2 overflow-hidden rounded-full'>
                      <div className='bg-primary/70 h-full rounded-full' style={{ width: `${(d.count / maxDept) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Team members */}
      <Card>
        <CardHeader className='flex-row items-start justify-between space-y-0'>
          <div>
            <CardTitle>Tim Saya</CardTitle>
            <CardDescription>{team.total} karyawan melapor langsung ke Anda.</CardDescription>
          </div>
          <SeeAll href='/dashboard/karyawan' />
        </CardHeader>
        <CardContent>
          {members.length === 0 ? (
            <EmptyState icon='teams' text='Belum ada anggota tim.' />
          ) : (
            <div className='grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3'>
              {members.map((m) => {
                const active = m.employment_status === 'ACTIVE';
                return (
                  <Link
                    key={m.id}
                    href={`/dashboard/karyawan/${m.id}`}
                    className='hover:bg-muted/60 hover:border-ring/50 flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors'
                  >
                    <span className='bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold'>
                      {initials(m.full_name)}
                    </span>
                    <div className='min-w-0 flex-1'>
                      <p className='truncate text-sm font-medium'>{m.full_name}</p>
                      <p className='text-muted-foreground truncate text-xs'>
                        {[m.position_name, m.department_name].filter(Boolean).join(' · ') || m.employee_id}
                      </p>
                    </div>
                    <Badge variant='secondary' className={active ? TONES.emerald : TONES.slate}>
                      {active ? 'Aktif' : 'Nonaktif'}
                    </Badge>
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Leave summary */}
      <Card>
        <CardHeader className='flex-row items-start justify-between space-y-0'>
          <div>
            <CardTitle>Ringkasan Izin & Cuti Tim</CardTitle>
            <CardDescription>Seluruh pengajuan dari tim Anda.</CardDescription>
          </div>
          <SeeAll href='/dashboard/management/leave' label='Lihat Pengajuan' />
        </CardHeader>
        <CardContent>
          <div className='grid grid-cols-2 gap-2 sm:grid-cols-5'>
            {[
              { label: 'Pending', value: leave.pending, tone: 'amber' as Tone },
              { label: 'Disetujui', value: leave.approved, tone: 'emerald' as Tone },
              { label: 'Ditolak', value: leave.rejected, tone: 'rose' as Tone },
              { label: 'Dibatalkan', value: leave.cancelled, tone: 'slate' as Tone },
              { label: 'Total', value: leave.total, tone: 'primary' as Tone }
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
      <div className='grid grid-cols-2 gap-2 md:grid-cols-5'>
        {[
          { href: '/dashboard/karyawan', label: 'Lihat Tim', icon: 'teams' as const },
          { href: '/dashboard/management/leave', label: 'Persetujuan Cuti', icon: 'leave' as const },
          { href: '/dashboard/management/leave/new', label: 'Ajukan Cuti', icon: 'calendar' as const },
          { href: '/dashboard/management/reimbursement', label: 'Reimbursement Saya', icon: 'receipt' as const },
          { href: '/dashboard/management/payroll', label: 'Slip Gaji', icon: 'wallet' as const }
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
