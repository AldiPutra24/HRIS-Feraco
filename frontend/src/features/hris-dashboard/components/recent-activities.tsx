'use client';

import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Icons } from '@/components/icons';
import type { DashboardActivity } from '@/lib/dashboard';

const ACTION_META: Record<string, { icon: keyof typeof Icons; label: string; accent: string }> = {
  create: { icon: 'add', label: 'Menambahkan', accent: 'bg-emerald-500/10 text-emerald-600' },
  update: { icon: 'edit', label: 'Memperbarui', accent: 'bg-blue-500/10 text-blue-600' },
  delete: { icon: 'trash', label: 'Menghapus', accent: 'bg-red-500/10 text-red-600' },
  approve: { icon: 'circleCheck', label: 'Menyetujui', accent: 'bg-emerald-500/10 text-emerald-600' },
  reject: { icon: 'xCircle', label: 'Menolak', accent: 'bg-red-500/10 text-red-600' },
  activate: { icon: 'circleCheck', label: 'Mengaktifkan', accent: 'bg-emerald-500/10 text-emerald-600' },
  terminate: { icon: 'xCircle', label: 'Menghentikan', accent: 'bg-red-500/10 text-red-600' },
  renew: { icon: 'refresh', label: 'Memperbarui kontrak', accent: 'bg-blue-500/10 text-blue-600' },
  upload: { icon: 'upload', label: 'Mengunggah', accent: 'bg-blue-500/10 text-blue-600' },
  download: { icon: 'download', label: 'Mengunduh', accent: 'bg-slate-500/10 text-slate-600' },
  login: { icon: 'login', label: 'Login', accent: 'bg-slate-500/10 text-slate-600' },
  logout: { icon: 'logout', label: 'Logout', accent: 'bg-slate-500/10 text-slate-600' },
  permission_change: { icon: 'lock', label: 'Mengubah izin', accent: 'bg-amber-500/10 text-amber-600' },
  role_change: { icon: 'userPen', label: 'Mengubah peran', accent: 'bg-amber-500/10 text-amber-600' }
};

const FALLBACK_META = { icon: 'clock' as const, label: 'Aktivitas', accent: 'bg-slate-500/10 text-slate-600' };

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

export function RecentActivities({
  activities,
  loading
}: {
  activities: DashboardActivity[];
  loading: boolean;
}) {
  return (
    <Card className='h-full'>
      <CardHeader>
        <div className='flex items-center justify-between'>
          <div>
            <CardTitle>Aktivitas Terbaru</CardTitle>
            <CardDescription>Aktivitas terbaru di seluruh HRIS.</CardDescription>
          </div>
          <Link
            href='/dashboard/settings/audit-log'
            className='text-primary inline-flex items-center gap-1 text-sm font-medium hover:underline'
          >
            Lihat Semua
            <Icons.arrowRight className='size-4' />
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className='space-y-4'>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className='flex items-center gap-3'>
                <Skeleton className='size-9 rounded-lg' />
                <div className='flex-1 space-y-1.5'>
                  <Skeleton className='h-3.5 w-3/4' />
                  <Skeleton className='h-3 w-1/2' />
                </div>
              </div>
            ))}
          </div>
        ) : activities.length === 0 ? (
          <div className='flex flex-col items-center gap-2 py-8 text-center'>
            <Icons.clock className='text-muted-foreground size-8' />
            <p className='text-sm font-medium'>Belum ada aktivitas</p>
            <p className='text-muted-foreground text-sm'>Aktivitas terbaru akan tampil di sini.</p>
          </div>
        ) : (
          <div className='space-y-4'>
            {activities.map((activity) => {
              const meta = ACTION_META[activity.action] ?? FALLBACK_META;
              const Icon = Icons[meta.icon];
              const target = activity.object_repr || activity.description || '—';
              return (
                <div key={activity.id} className='flex items-start gap-3'>
                  <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${meta.accent}`}>
                    <Icon className='size-4' />
                  </span>
                  <div className='min-w-0 flex-1'>
                    <p className='truncate text-sm font-medium'>
                      {activity.actor ?? 'Sistem'}{' '}
                      <span className='text-muted-foreground font-normal'>{meta.label}</span> {target}
                    </p>
                    <p className='text-muted-foreground text-xs'>{relativeTime(activity.timestamp)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
