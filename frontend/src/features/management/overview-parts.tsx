'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';
import type { AppNotification } from '@/lib/notifications';
import type { ManagementPendingLeave } from '@/lib/management';

// Shared building blocks for the General Manager and Management overviews.

export function fmtShort(iso: string): string {
  return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}

export function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function initials(name: string): string {
  return name
    .replace(/\([^)]*\)/g, '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

export function greeting(): string {
  const h = new Date().getHours();
  if (h < 11) return 'Selamat pagi';
  if (h < 15) return 'Selamat siang';
  if (h < 18) return 'Selamat sore';
  return 'Selamat malam';
}

export function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

export function Initials({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={cn(
        'bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
        className
      )}
    >
      {initials(name)}
    </span>
  );
}

export function Bar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn('bg-muted h-1.5 w-full overflow-hidden rounded-full', className)}>
      <div className='bg-primary h-full rounded-full' style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function ArrowLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className='inline-flex shrink-0 items-center gap-1 text-sm font-semibold hover:underline'>
      {children}
      <Icons.arrowRight className='size-4' />
    </Link>
  );
}

export function StatusPill({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
        active ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
      )}
    >
      <span className={cn('size-1.5 rounded-full', active ? 'bg-primary' : 'bg-muted-foreground')} />
      {active ? 'Aktif' : 'Nonaktif'}
    </span>
  );
}

/** Mono date line, greeting, subtitle and the action buttons. */
export function DashboardHeader({
  name,
  subtitle,
  fetchedAt,
  onRefresh,
  children
}: {
  name: string;
  subtitle: string;
  fetchedAt: Date | null;
  onRefresh: () => void;
  children: ReactNode;
}) {
  const today = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return (
    <div className='flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between'>
      <div className='min-w-0'>
        <p className='text-muted-foreground font-mono text-xs tracking-widest uppercase'>
          {today}
          {fetchedAt && ` · diperbarui ${fetchedAt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`}
        </p>
        <h2 className='mt-1 text-3xl font-bold tracking-tight'>
          {greeting()}
          {name ? `, ${name}` : ''}
        </h2>
        <p className='text-muted-foreground mt-1'>{subtitle}</p>
      </div>
      <div className='flex flex-wrap items-center gap-2'>
        <button
          type='button'
          onClick={onRefresh}
          aria-label='Muat ulang'
          title='Muat ulang'
          className={cn(buttonVariants({ variant: 'outline', size: 'icon' }), 'size-10')}
        >
          <Icons.refresh className='size-4' />
        </button>
        {children}
      </div>
    </div>
  );
}

export function HeaderLink({ href, icon, children }: { href: string; icon: keyof typeof Icons; children: ReactNode }) {
  const Icon = Icons[icon];
  return (
    <Link href={href} className={cn(buttonVariants({ variant: 'outline' }), 'h-10 px-4')}>
      <Icon className='size-4' />
      {children}
    </Link>
  );
}

/** Primary "Persetujuan Cuti" button with the awaiting-me counter. */
export function ApprovalButton({ count }: { count: number }) {
  return (
    <Link href='/dashboard/management/leave' className={cn(buttonVariants(), 'h-10 px-4')}>
      <Icons.check className='size-4' />
      Persetujuan Cuti
      <span className='bg-primary-foreground/20 rounded-full px-2 text-xs font-semibold tabular-nums'>{count}</span>
    </Link>
  );
}

export function ApprovalItem({ leave }: { leave: ManagementPendingLeave }) {
  return (
    <li>
      <Link
        href='/dashboard/management/leave'
        className='hover:bg-muted/50 flex items-center gap-3 px-5 py-3 transition-colors'
      >
        <span className='flex size-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-300'>
          <Icons.calendar className='size-4' />
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

/** "Aktivitas Terbaru": the caller's own notifications (never other users' activity). */
export function ActivityCard({
  notifications,
  description,
  href = '/dashboard/management/leave',
  className
}: {
  notifications: AppNotification[];
  description?: string;
  href?: string;
  className?: string;
}) {
  return (
    <Card className={cn('gap-0 py-0', className)}>
      <div className='flex items-start justify-between gap-2 px-5 pt-5 pb-3'>
        <div>
          <h3 className='text-base font-semibold'>Aktivitas Terbaru</h3>
          {description && <p className='text-muted-foreground mt-0.5 text-sm'>{description}</p>}
        </div>
        <ArrowLink href={href}>Lihat semua</ArrowLink>
      </div>
      {notifications.length === 0 ? (
        <p className='text-muted-foreground px-5 pt-2 pb-6 text-sm'>Belum ada aktivitas terbaru.</p>
      ) : (
        <ul className='divide-y px-5 pb-3'>
          {notifications.map((n) => {
            const leave = n.kind.startsWith('LEAVE');
            const body = (
              <>
                <span
                  className={cn(
                    'flex size-9 shrink-0 items-center justify-center rounded-lg',
                    leave ? 'bg-orange-500/10 text-orange-700 dark:text-orange-300' : 'bg-muted text-muted-foreground'
                  )}
                >
                  {leave ? <Icons.calendar className='size-4' /> : <Icons.notification className='size-4' />}
                </span>
                <span className='min-w-0 flex-1'>
                  <span className='block truncate text-sm font-medium'>{n.title || n.message}</span>
                  <span className='text-muted-foreground block truncate text-xs'>
                    {n.title ? `${n.message} · ` : ''}
                    {fmtShort(n.created_at)}
                  </span>
                </span>
                {n.link && <Icons.chevronRight className='text-muted-foreground size-4 shrink-0' />}
              </>
            );
            return (
              <li key={n.id}>
                {n.link ? (
                  <Link href={n.link} className='hover:bg-muted/50 -mx-2 flex items-center gap-3 rounded-md px-2 py-3'>
                    {body}
                  </Link>
                ) : (
                  <div className='flex items-center gap-3 py-3'>{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
