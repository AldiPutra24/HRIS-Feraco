'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Icons } from '@/components/icons';
import { getManagementDashboard, type ManagementDashboard, type ManagementPendingLeave, type ManagementTeamMember } from '@/lib/management';
import { listNotifications, type AppNotification } from '@/lib/notifications';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'baru saja';
  if (mins < 60) return `${mins} menit lalu`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} jam lalu`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} hari lalu`;
  return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  ACTIVE: { label: 'Aktif', className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
  INACTIVE: { label: 'Nonaktif', className: 'bg-slate-500/10 text-slate-600 dark:text-slate-400' },
};

const NOTIF_ICON: Record<string, keyof typeof Icons> = {
  LEAVE_SUBMITTED: 'leave',
  LEAVE_APPROVED: 'leave',
  LEAVE_REJECTED: 'leave',
  CONTRACT: 'page',
  BIRTHDAY: 'user',
};

function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

function KpiCard({
  label, value, icon, accent,
}: {
  label: string;
  value: number;
  icon: keyof typeof Icons;
  accent?: boolean;
}) {
  const Icon = Icons[icon];
  return (
    <Card className='gap-2 py-4 transition-colors hover:border-ring/60'>
      <CardHeader className='flex-row items-center justify-between space-y-0 px-4 pb-0'>
        <CardTitle className='text-muted-foreground text-xs font-medium'>{label}</CardTitle>
        <Icon className='text-muted-foreground/70 size-4' />
      </CardHeader>
      <CardContent className='px-4'>
        <p className={`text-2xl font-semibold tabular-nums ${accent ? 'text-amber-600 dark:text-amber-400' : ''}`}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

function SectionCard({
  title, action, children, className = '',
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader className='flex-row items-center justify-between space-y-0 pb-3'>
        <CardTitle className='text-base font-semibold'>{title}</CardTitle>
        {action}
      </CardHeader>
      <CardContent className='pt-0'>{children}</CardContent>
    </Card>
  );
}

function SeeAllLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className='text-primary inline-flex items-center gap-1 text-xs font-medium hover:underline'
    >
      {label}
      <Icons.arrowRight className='size-3.5' />
    </Link>
  );
}

function AttentionItem({ leave }: { leave: ManagementPendingLeave }) {
  return (
    <div className='flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 transition-colors hover:bg-muted/50'>
      <div className='flex min-w-0 items-center gap-3'>
        <span className='bg-amber-500/10 text-amber-600 dark:text-amber-400 flex size-8 shrink-0 items-center justify-center rounded-full'>
          <Icons.leave className='size-4' />
        </span>
        <div className='min-w-0'>
          <p className='truncate text-sm font-medium'>{leave.employee_name}</p>
          <p className='text-muted-foreground truncate text-xs'>
            {leave.leave_type_name} · {fmtDate(leave.start_date)} – {fmtDate(leave.end_date)} ({leave.total_days} hari)
          </p>
        </div>
      </div>
      <SeeAllLink href='/dashboard/management/leave' label='Lihat' />
    </div>
  );
}

function TeamMemberRow({ member }: { member: ManagementTeamMember }) {
  const badge = STATUS_BADGE[member.employment_status] ?? STATUS_BADGE.INACTIVE;
  return (
    <div className='flex items-center justify-between gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-muted/50'>
      <div className='flex min-w-0 items-center gap-3'>
        <span className='bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold'>
          {member.full_name.slice(0, 2).toUpperCase()}
        </span>
        <div className='min-w-0'>
          <p className='truncate text-sm font-medium'>{member.full_name}</p>
          <p className='text-muted-foreground truncate text-xs'>
            {member.position_name ?? '—'}{member.department_name ? ` · ${member.department_name}` : ''}
          </p>
        </div>
      </div>
      <Badge variant='secondary' className={badge.className}>
        {badge.label}
      </Badge>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function ManagementOverview() {
  const [data, setData] = useState<ManagementDashboard | null>(null);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [d, n] = await Promise.all([
        getManagementDashboard(),
        listNotifications().catch(() => ({ results: [] as AppNotification[], unread: 0 })),
      ]);
      setData(d);
      setNotifications(n.results.slice(0, 5));
      setFetchedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className='flex flex-1 flex-col gap-4 p-4 md:p-6'>
        <div className='space-y-2'>
          <Skeleton className='h-7 w-64' />
          <Skeleton className='h-4 w-96' />
        </div>
        <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4'>
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className='h-24 w-full' />)}
        </div>
        <div className='grid grid-cols-1 gap-4 lg:grid-cols-2'>
          <Skeleton className='h-56 w-full' />
          <Skeleton className='h-56 w-full' />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className='p-4 md:p-6'>
        <Card className='border-destructive/30'>
          <CardContent className='flex flex-col items-start gap-3 p-6'>
            <p className='text-destructive text-sm font-medium'>{error || 'Gagal memuat data.'}</p>
            <Button size='sm' variant='outline' onClick={load}>
              <Icons.refresh className='size-4' />
              Coba Lagi
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { team, leave, pending_leave_items: pendingItems, team_members: teamMembers } = data;
  const attention: React.ReactNode[] = pendingItems.map((l) => <AttentionItem key={l.id} leave={l} />);

  return (
    <div className='flex flex-1 flex-col gap-5 p-4 md:p-6'>
      {/* Header */}
      <div>
        <h2 className='text-2xl font-bold tracking-tight'>Management Overview</h2>
        <div className='flex flex-wrap items-center gap-x-2'>
          <p className='text-muted-foreground text-sm'>
            Ringkasan tim dan aktivitas yang membutuhkan perhatian Anda.
          </p>
          {fetchedAt && (
            <span className='text-muted-foreground/70 text-xs'>
              Update terakhir {fetchedAt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
      </div>

      {/* KPI */}
      <div className='grid grid-cols-2 gap-3 lg:grid-cols-4'>
        <KpiCard label='Total Tim' value={team.total} icon='teams' />
        <KpiCard label='Karyawan Aktif' value={team.active} icon='user' />
        <KpiCard label='Izin/Cuti Pending' value={leave.pending} icon='leave' accent={leave.pending > 0} />
        <KpiCard label='Reimbursement Pending' value={0} icon='receipt' />
      </div>

      {/* Perlu Perhatian */}
      <SectionCard
        title='Perlu Perhatian'
        action={pendingItems.length > 0 ? <SeeAllLink href='/dashboard/management/leave' label='Lihat Semua' /> : undefined}
      >
        {attention.length === 0 ? (
          <div className='flex items-center gap-2 rounded-lg border border-dashed px-4 py-6'>
            <Icons.check className='text-emerald-600 dark:text-emerald-400 size-4' />
            <p className='text-muted-foreground text-sm'>Tidak ada hal yang perlu ditindaklanjuti.</p>
          </div>
        ) : (
          <div className='flex flex-col gap-2'>
            {attention}
            {leave.pending > pendingItems.length && (
              <p className='text-muted-foreground px-1 text-xs'>
                +{leave.pending - pendingItems.length} pengajuan pending lainnya
              </p>
            )}
          </div>
        )}
      </SectionCard>

      {/* Tim Saya + Ringkasan Izin & Cuti */}
      <div className='grid grid-cols-1 gap-4 lg:grid-cols-2'>
        <SectionCard
          title='Tim Saya'
          action={<SeeAllLink href='/dashboard/karyawan' label='Lihat Semua' />}
        >
          {teamMembers.length === 0 ? (
            <p className='text-muted-foreground py-4 text-center text-sm'>Belum ada anggota tim.</p>
          ) : (
            <div className='flex flex-col'>
              {teamMembers.map((m) => <TeamMemberRow key={m.id} member={m} />)}
            </div>
          )}
        </SectionCard>

        <SectionCard
          title='Ringkasan Izin & Cuti'
          action={<SeeAllLink href='/dashboard/management/leave' label='Lihat Pengajuan' />}
        >
          <div className='grid grid-cols-2 gap-2'>
            {[
              { label: 'Pending', value: leave.pending, accent: leave.pending > 0 },
              { label: 'Disetujui', value: leave.approved },
              { label: 'Ditolak', value: leave.rejected },
              { label: 'Dibatalkan', value: leave.cancelled },
            ].map((row) => (
              <div key={row.label} className='rounded-lg border px-3 py-2.5'>
                <p className='text-muted-foreground text-xs'>{row.label}</p>
                <p className={`text-lg font-semibold tabular-nums ${row.accent ? 'text-amber-600 dark:text-amber-400' : ''}`}>
                  {row.value}
                </p>
              </div>
            ))}
          </div>
          <div className='mt-2 flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2.5'>
            <span className='text-sm font-medium'>Total Pengajuan</span>
            <span className='text-sm font-semibold tabular-nums'>{leave.total}</span>
          </div>
        </SectionCard>
      </div>

      {/* Aktivitas Terbaru */}
      <SectionCard title='Aktivitas Terbaru'>
        {notifications.length === 0 ? (
          <p className='text-muted-foreground py-4 text-center text-sm'>Belum ada aktivitas terbaru.</p>
        ) : (
          <ul className='divide-y'>
            {notifications.map((n) => {
              const Icon = Icons[NOTIF_ICON[n.kind] ?? 'notification'];
              return (
                <li key={n.id} className='flex items-start gap-3 py-2.5 first:pt-0 last:pb-0'>
                  <span className='bg-muted flex size-8 shrink-0 items-center justify-center rounded-full'>
                    <Icon className='text-muted-foreground size-4' />
                  </span>
                  <div className='min-w-0 flex-1'>
                    <p className='truncate text-sm'>{n.message}</p>
                    <p className='text-muted-foreground text-xs'>{relativeTime(n.created_at)}</p>
                  </div>
                  {n.link && (
                    <Link href={n.link} className='text-muted-foreground hover:text-foreground shrink-0 self-center'>
                      <Icons.arrowRight className='size-4' />
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      {/* Quick Actions */}
      <div className='flex flex-wrap gap-2'>
        {[
          { href: '/dashboard/karyawan', label: 'Lihat Tim', icon: 'teams' as const },
          { href: '/dashboard/management/leave', label: 'Persetujuan Cuti', icon: 'leave' as const },
          { href: '/dashboard/management/reimbursement', label: 'Reimbursement Saya', icon: 'receipt' as const },
          { href: '/dashboard/management/payroll', label: 'Slip Gaji', icon: 'wallet' as const },
        ].map((a) => {
          const Icon = Icons[a.icon];
          return (
            <Link
              key={a.href}
              href={a.href}
              className='border-border hover:bg-muted focus-visible:ring-ring inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none'
            >
              <Icon className='size-4' />
              {a.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
