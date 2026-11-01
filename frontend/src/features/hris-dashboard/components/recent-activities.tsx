'use client';

import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';
import type { DashboardActivity } from '@/lib/dashboard';

const ACTION_META: Record<string, { icon: keyof typeof Icons; verb: string; accent?: string }> = {
  create: { icon: 'plus', verb: 'menambahkan', accent: 'bg-blue-500/10 text-blue-600' },
  update: { icon: 'edit', verb: 'memperbarui' },
  delete: { icon: 'trash', verb: 'menghapus', accent: 'bg-red-500/10 text-red-600' },
  approve: { icon: 'check', verb: 'menyetujui', accent: 'bg-emerald-500/10 text-emerald-600' },
  reject: { icon: 'close', verb: 'menolak', accent: 'bg-red-500/10 text-red-600' },
  activate: { icon: 'check', verb: 'mengaktifkan', accent: 'bg-emerald-500/10 text-emerald-600' },
  terminate: { icon: 'close', verb: 'menghentikan', accent: 'bg-red-500/10 text-red-600' },
  renew: { icon: 'refresh', verb: 'memperpanjang' },
  upload: { icon: 'page', verb: 'mengunggah' },
  download: { icon: 'page', verb: 'mengunduh' },
  permission_change: { icon: 'lock', verb: 'mengubah izin', accent: 'bg-amber-500/10 text-amber-600' },
  role_change: { icon: 'userPen', verb: 'mengubah peran', accent: 'bg-amber-500/10 text-amber-600' }
};

const FALLBACK_META = { icon: 'clock' as const, verb: 'mengubah' };

/** Object noun from the audit content type ("mengunduh dokumen"). */
function objectNoun(action: string, type: string | null): string {
  const t = type ?? '';
  if (action === 'upload' || action === 'download' || t.includes('document') || t.includes('attachment')) return 'dokumen';
  if (t.includes('contract')) return 'kontrak';
  if (t.includes('announcement')) return 'pengumuman';
  if (t.includes('leave') || t.includes('reimburse') || t.includes('overtime') || t.includes('request')) return 'pengajuan';
  if (t.includes('payroll') || t.includes('payslip')) return 'payroll';
  if (action === 'role_change' || action === 'permission_change') return '';
  return 'data';
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'baru saja';
  if (mins < 60) return `${mins} menit lalu`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} jam lalu`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} hari lalu`;
  return new Date(iso).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function RecentActivities({ activities, loading }: { activities: DashboardActivity[]; loading: boolean }) {
  return (
    <Card className='gap-0 py-0'>
      <div className='flex items-center justify-between gap-2 px-5 pt-5 pb-3'>
        <h3 className='text-base font-semibold'>Aktivitas terbaru</h3>
        <Link href='/dashboard/settings/audit-log' className='shrink-0 text-sm font-medium hover:underline'>
          Lihat semua
        </Link>
      </div>
      <div className='px-5 pb-4'>
        {loading ? (
          <div className='space-y-4 py-2'>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className='flex items-center gap-3'>
                <Skeleton className='size-7 rounded-md' />
                <div className='flex-1 space-y-1.5'>
                  <Skeleton className='h-3.5 w-3/4' />
                  <Skeleton className='h-3 w-1/2' />
                </div>
              </div>
            ))}
          </div>
        ) : activities.length === 0 ? (
          <div className='flex flex-col items-center gap-2 py-8 text-center'>
            <Icons.clock className='text-muted-foreground size-7' />
            <p className='text-sm font-medium'>Belum ada aktivitas</p>
            <p className='text-muted-foreground text-sm'>Aktivitas terbaru akan tampil di sini.</p>
          </div>
        ) : (
          <ul className='divide-y'>
            {activities.map((activity) => {
              const meta = ACTION_META[activity.action] ?? FALLBACK_META;
              const Icon = Icons[meta.icon];
              const noun = objectNoun(activity.action, activity.object_type);
              const target = activity.object_repr || activity.description || '';
              return (
                <li key={activity.id} className='flex items-start gap-3 py-3'>
                  <span
                    className={cn(
                      'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md',
                      'accent' in meta && meta.accent ? meta.accent : 'bg-muted text-muted-foreground'
                    )}
                  >
                    <Icon className='size-3.5' />
                  </span>
                  <div className='min-w-0 flex-1'>
                    <p className='truncate text-sm'>
                      <span className='font-semibold'>{activity.actor ?? 'Sistem'}</span> {meta.verb}
                      {noun && ` ${noun}`}
                    </p>
                    <p className='text-muted-foreground truncate text-xs'>
                      {target && `${target} · `}
                      {relativeTime(activity.timestamp)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}
