'use client';

import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Icons } from '@/components/icons';

export function NotificationBell() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant='secondary' size='icon' className='size-8' aria-label='Notifikasi'>
            <Icons.notification />
            <span className='sr-only'>Notifikasi</span>
          </Button>
        }
      />
      <DropdownMenuContent align='end' sideOffset={8} className='w-72'>
        <p className='px-3 py-2 text-sm font-semibold'>Notifikasi</p>
        <div className='border-t pt-2'>
          <p className='text-muted-foreground px-3 py-6 text-center text-sm'>Belum ada notifikasi.</p>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
