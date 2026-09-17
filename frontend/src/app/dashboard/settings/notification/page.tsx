import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Icons } from '@/components/icons';
import { NotificationSettings } from '@/features/settings/notification-settings';

export const metadata = { title: 'Notification & Email Template' };

export default function Page() {
  return (
    <div className='flex flex-1 flex-col gap-4 p-4 md:p-6'>
      <div className='flex flex-wrap items-start justify-between gap-4'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>Notification &amp; Email Template</h2>
          <p className='text-muted-foreground text-sm'>
            Atur penerima HR, toggle event, dan template email notifikasi.
          </p>
        </div>
        <Button variant='outline' size='sm' render={<Link href='/dashboard/settings/delivery-logs' aria-label='Lihat Riwayat Delivery' />}>
          <Icons.send />
          Lihat Riwayat Delivery
        </Button>
      </div>
      <NotificationSettings />
    </div>
  );
}
