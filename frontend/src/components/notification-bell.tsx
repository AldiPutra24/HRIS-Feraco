'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Icons } from '@/components/icons';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type AppNotification,
} from '@/lib/notifications';

const POLL_MS = 60_000;

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'baru saja';
  if (mins < 60) return `${mins} menit lalu`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} jam lalu`;
  return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}

export function NotificationBell() {
  const router = useRouter();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await listNotifications();
      setItems(data.results);
      setUnread(data.unread);
    } catch {
      // Bell is non-critical; stay silent on errors (e.g. logged out).
    }
  }, []);

  useEffect(() => {
    load();
    timer.current = setInterval(load, POLL_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [load]);

  async function handleMarkRead(n: AppNotification) {
    if (!n.is_read) {
      try {
        await markNotificationRead(n.id);
        setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)));
        setUnread((u) => Math.max(0, u - 1));
      } catch {
        // ignore
      }
    }
    if (n.link) router.push(n.link);
  }

  async function handleMarkAll() {
    try {
      await markAllNotificationsRead();
      setItems((prev) => prev.map((x) => ({ ...x, is_read: true })));
      setUnread(0);
    } catch {
      // ignore
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant='secondary' size='icon' className='relative size-8' aria-label='Notifikasi'>
            <Icons.notification />
            {unread > 0 && (
              <span className='absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white'>
                {unread > 9 ? '9+' : unread}
              </span>
            )}
            <span className='sr-only'>Notifikasi</span>
          </Button>
        }
      />
      <DropdownMenuContent align='end' sideOffset={8} className='w-96 p-0'>
        <div className='flex items-center justify-between border-b px-3 py-2'>
          <p className='text-sm font-semibold'>
            Notifikasi{unread > 0 ? ` (${unread})` : ''}
          </p>
          {unread > 0 && (
            <button
              type='button'
              className='text-primary text-xs font-medium hover:underline'
              onClick={handleMarkAll}
            >
              Tandai semua dibaca
            </button>
          )}
        </div>
        <div className='max-h-96 overflow-y-auto'>
          {loading && items.length === 0 ? (
            <p className='text-muted-foreground px-3 py-6 text-center text-sm'>Memuat…</p>
          ) : items.length === 0 ? (
            <p className='text-muted-foreground px-3 py-6 text-center text-sm'>Belum ada notifikasi.</p>
          ) : (
            items.map((n) => (
              <button
                key={n.id}
                type='button'
                onClick={() => handleMarkRead(n)}
                className={`block w-full border-b px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-accent ${
                  n.is_read ? 'opacity-60' : ''
                }`}
              >
                <div className='flex items-start gap-2'>
                  {!n.is_read && <span className='bg-primary mt-1.5 size-2 shrink-0 rounded-full' />}
                  <div className='min-w-0'>
                    {n.title && <p className='truncate text-sm font-medium'>{n.title}</p>}
                    <p className='text-muted-foreground line-clamp-2 text-xs'>{n.message}</p>
                    <p className='text-muted-foreground/70 mt-0.5 text-[10px]'>{timeAgo(n.created_at)}</p>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
