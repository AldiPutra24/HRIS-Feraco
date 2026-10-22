'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Icons } from '@/components/icons';
import { getManagementDashboard, type ManagementDashboard } from '@/lib/management';
import { listNotifications, type AppNotification } from '@/lib/notifications';
import { listAnnouncements, type Announcement } from '@/lib/announcements';
import { GmOverview } from './gm-overview';
import { ManagementTeamOverview } from './management-team-overview';

function fmtDateLong(d: string): string {
  return new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * /dashboard/management/overview — loads the dashboard data once and renders
 * the General Manager view (company-wide, backend sends `company`) or the
 * Management view (direct reports). Both share the same visual language.
 */
export function ManagementOverview() {
  const [data, setData] = useState<ManagementDashboard | null>(null);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [announcementDetail, setAnnouncementDetail] = useState<Announcement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [d, n, a] = await Promise.all([
        getManagementDashboard(),
        listNotifications().catch(() => ({ results: [] as AppNotification[], unread: 0 })),
        listAnnouncements().catch(() => [] as Announcement[]),
      ]);
      setData(d);
      setNotifications(n.results.slice(0, 5));
      setAnnouncements(a.filter((x) => x.status === 'ACTIVE').slice(0, 3));
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
      <div className='flex flex-1 flex-col gap-5 p-4 md:p-6'>
        <Skeleton className='h-32 w-full rounded-2xl' />
        <div className='grid grid-cols-2 gap-3 xl:grid-cols-4'>
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className='h-24 w-full' />)}
        </div>
        <div className='grid grid-cols-1 gap-4 lg:grid-cols-3'>
          <Skeleton className='h-56 w-full lg:col-span-2' />
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

  const shared = {
    announcements,
    notifications,
    fetchedAt,
    onRefresh: load,
    onOpenAnnouncement: setAnnouncementDetail
  };
  const company = data.company;

  return (
    <>
      {company ? <GmOverview data={{ ...data, company }} {...shared} /> : <ManagementTeamOverview data={data} {...shared} />}

      {/* Announcement detail sheet (same flow as Employee Dashboard) */}
      <Sheet open={announcementDetail !== null} onOpenChange={(o) => !o && setAnnouncementDetail(null)}>
        <SheetContent side='right' className='w-full sm:max-w-md'>
          <SheetHeader>
            <SheetTitle>{announcementDetail?.title}</SheetTitle>
            <SheetDescription>
              Dipublikasikan {announcementDetail ? fmtDateLong(announcementDetail.created_at) : ''}
              {announcementDetail?.created_by_name ? ` · ${announcementDetail.created_by_name}` : ''}
            </SheetDescription>
          </SheetHeader>
          <div className='whitespace-pre-wrap px-4 py-4 text-sm'>{announcementDetail?.body}</div>
        </SheetContent>
      </Sheet>
    </>
  );
}
