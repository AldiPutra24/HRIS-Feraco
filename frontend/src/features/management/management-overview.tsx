'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Icons } from '@/components/icons';
import { getManagementDashboard, type ManagementDashboard } from '@/lib/management';
import { listNotifications, type AppNotification } from '@/lib/notifications';
import { GmOverview } from './gm-overview';
import { ManagementTeamOverview } from './management-team-overview';

/**
 * /dashboard/management — loads the dashboard data once and renders
 * the General Manager view (company-wide, backend sends `company`) or the
 * Management view (direct reports). Both share the same visual language.
 */
export function ManagementOverview() {
  const [data, setData] = useState<ManagementDashboard | null>(null);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  // Bumped on refresh so self-loading widgets (announcements) reload too.
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [d, n] = await Promise.all([
        getManagementDashboard(),
        listNotifications().catch(() => ({ results: [] as AppNotification[], unread: 0 }))
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

  const refresh = () => {
    setReloadKey((k) => k + 1);
    load();
  };

  if (loading && !data) {
    return (
      <div className='flex flex-1 flex-col gap-5 p-4 md:p-8'>
        <Skeleton className='h-20 w-full' />
        <div className='grid grid-cols-2 gap-3 xl:grid-cols-4'>
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className='h-28 w-full' />)}
        </div>
        <div className='grid grid-cols-1 gap-4 lg:grid-cols-3'>
          <Skeleton className='h-72 w-full lg:col-span-2' />
          <Skeleton className='h-72 w-full' />
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

  const shared = { notifications, fetchedAt, reloadKey, onRefresh: refresh };
  const company = data.company;

  return company ? <GmOverview data={{ ...data, company }} {...shared} /> : <ManagementTeamOverview data={data} {...shared} />;
}
