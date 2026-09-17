import { NotificationSettings } from '@/features/settings/notification-settings';

export const metadata = { title: 'Notification & Email Template' };

export default function Page() {
  return (
    <div className='flex flex-1 flex-col gap-4 p-4 md:p-6'>
      <div>
        <h2 className='text-2xl font-bold tracking-tight'>Notification &amp; Email Template</h2>
        <p className='text-muted-foreground text-sm'>
          Atur penerima HR, toggle event, dan template email notifikasi.
        </p>
      </div>
      <NotificationSettings />
    </div>
  );
}
