'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Icons } from '@/components/icons';
import {
  AnnouncementBanner,
  AnnouncementFeed,
  useAnnouncementFeed
} from '@/features/announcements/announcement-feed';
import { WhosOffToday } from '@/features/leaves/whos-off-today';
import { useAuth } from '@/lib/auth/auth-provider';
import type { OffTodayItem } from '@/lib/leaves';
import type { AppNotification } from '@/lib/notifications';
import type { ManagementDashboard } from '@/lib/management';
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
  pct
} from './overview-parts';
import { MyLeaveCard } from './my-leave-card';

// Management dashboard. Data is the manager's direct reports only (backend
// /dashboard/management/ scope).

const PERSONAL_LINKS: { label: string; href: string; icon: keyof typeof Icons }[] = [
  { label: 'Ajukan cuti', href: '/dashboard/management/leave/new', icon: 'calendar' },
  { label: 'Reimbursement saya', href: '/dashboard/management/reimbursement', icon: 'receipt' },
  { label: 'Slip gaji', href: '/dashboard/payroll', icon: 'wallet' }
];

export function ManagementTeamOverview({
  data,
  notifications,
  fetchedAt,
  reloadKey,
  onRefresh
}: {
  data: ManagementDashboard;
  notifications: AppNotification[];
  fetchedAt: Date | null;
  reloadKey: number;
  onRefresh: () => void;
}) {
  const { user } = useAuth();
  const { team, leave, pending_leave_items: pending, team_members: members } = data;
  const [offToday, setOffToday] = useState<OffTodayItem[]>([]);
  const announcementFeed = useAnnouncementFeed(reloadKey);
  const memberIds = new Set(members.map((m) => m.id));
  const teamOff = offToday.filter((o) => memberIds.has(o.employee_id)).length;

  return (
    <div className='flex flex-1 flex-col gap-6 p-4 md:p-8'>
      <DashboardHeader
        name={user?.name?.split(' ')[0] ?? ''}
        subtitle='Ringkasan tim yang melapor langsung ke Anda.'
        fetchedAt={fetchedAt}
        onRefresh={onRefresh}
      >
        <HeaderLink href='/dashboard/karyawan' icon='teams'>
          Lihat Tim
        </HeaderLink>
        <ApprovalButton count={leave.awaiting_me} />
      </DashboardHeader>

      <AnnouncementBanner feed={announcementFeed} />

      <div className='grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]'>
        <div className='flex min-w-0 flex-col gap-5'>
          <Card className='gap-0 overflow-hidden py-0'>
            <div className='flex items-start justify-between gap-3 px-5 pt-5 pb-4'>
              <div>
                <h3 className='text-base font-semibold'>Perlu persetujuan Anda</h3>
                <p className='text-muted-foreground mt-0.5 text-sm'>Pengajuan izin &amp; cuti dari tim, urut dari tanggal terdekat</p>
              </div>
              <span className='bg-muted shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums'>
                {leave.awaiting_me} menunggu
              </span>
            </div>
            <div className='border-t'>
              {pending.length === 0 ? (
                <div className='flex flex-col items-center gap-2 px-5 py-10 text-center'>
                  <span className='bg-primary/10 text-primary mb-2 flex size-14 items-center justify-center rounded-2xl'>
                    <Icons.check className='size-6' />
                  </span>
                  <p className='font-semibold'>Semua pengajuan sudah ditindaklanjuti</p>
                  <p className='text-muted-foreground text-sm'>
                    Pengajuan baru dari tim akan muncul di sini dan dikirim ke email Anda.
                  </p>
                </div>
              ) : (
                <ul className='divide-y'>
                  {pending.map((l) => (
                    <ApprovalItem key={l.id} leave={l} />
                  ))}
                  {leave.awaiting_me > pending.length && (
                    <li className='text-muted-foreground px-5 py-2.5 text-xs'>
                      +{leave.awaiting_me - pending.length} pengajuan lainnya
                    </li>
                  )}
                </ul>
              )}
            </div>
            <div className='bg-muted/40 flex flex-wrap items-center gap-x-10 gap-y-3 border-t px-5 py-4'>
              {[
                { label: 'Pending', value: leave.pending },
                { label: 'Disetujui', value: leave.approved },
                { label: 'Ditolak', value: leave.rejected },
                { label: 'Dibatalkan', value: leave.cancelled }
              ].map((row) => (
                <div key={row.label} className='min-w-16'>
                  <p className='text-muted-foreground text-xs'>{row.label}</p>
                  <p className='text-xl font-semibold tabular-nums'>{row.value}</p>
                </div>
              ))}
              <span className='ml-auto'>
                <ArrowLink href='/dashboard/management/leave'>Semua pengajuan</ArrowLink>
              </span>
            </div>
          </Card>

          <AnnouncementFeed feed={announcementFeed} />

          <div className='grid grid-cols-1 items-start gap-5 md:grid-cols-2'>
            <WhosOffToday href='/dashboard/management/leave' onLoaded={setOffToday} />
            <ActivityCard notifications={notifications} description='Notifikasi terkait tim Anda' />
          </div>
        </div>

        <div className='flex min-w-0 flex-col gap-5'>
          <MyLeaveCard reloadKey={reloadKey} />

          <Card className='gap-0 py-0'>
            <div className='px-5 pt-5 pb-5'>
              <div className='flex items-start justify-between gap-2'>
                <div>
                  <h3 className='text-base font-semibold'>Tim Saya</h3>
                  <p className='text-muted-foreground mt-0.5 text-sm'>Melapor langsung ke Anda</p>
                </div>
                <ArrowLink href='/dashboard/karyawan'>Lihat semua</ArrowLink>
              </div>
              <p className='mt-4 flex items-baseline gap-2'>
                <span className='text-4xl font-semibold tabular-nums'>{team.total}</span>
                <span>anggota</span>
              </p>
              <Bar value={pct(team.active, team.total)} className='mt-3 h-1.5' />
              <div className='text-muted-foreground mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs'>
                <span className='flex items-center gap-1.5'>
                  <span className='bg-primary size-2 rounded-sm' />
                  {team.active} aktif
                </span>
                <span className='flex items-center gap-1.5'>
                  <span className='bg-muted-foreground/30 size-2 rounded-sm' />
                  {team.inactive} nonaktif
                </span>
                <span className='flex items-center gap-1.5'>
                  <span className='size-2 rounded-sm bg-orange-500' />
                  {teamOff} cuti hari ini
                </span>
              </div>
            </div>
            {members.length > 0 ? (
              <ul className='max-h-96 divide-y overflow-y-auto border-t'>
                {members.map((m) => (
                  <li key={m.id}>
                    <Link
                      href={`/dashboard/karyawan/${m.id}`}
                      className='hover:bg-muted/50 flex items-center gap-3 px-5 py-3.5 transition-colors'
                    >
                      <Initials name={m.full_name} className='bg-primary/10 text-primary size-10' />
                      <div className='min-w-0 flex-1'>
                        <p className='truncate text-sm font-medium'>{m.full_name}</p>
                        <p className='text-muted-foreground truncate text-xs'>
                          {[m.position_name, m.department_name].filter(Boolean).join(' · ') || m.employee_id}
                        </p>
                      </div>
                      <StatusPill active={m.employment_status === 'ACTIVE'} />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className='text-muted-foreground border-t px-5 py-6 text-sm'>Belum ada anggota tim.</p>
            )}
          </Card>

          <Card className='gap-1 px-5 py-5'>
            <p className='text-muted-foreground mb-1 text-sm'>Untuk Anda pribadi</p>
            {PERSONAL_LINKS.map((s) => {
              const Icon = Icons[s.icon];
              return (
                <Link
                  key={s.href}
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
    </div>
  );
}
