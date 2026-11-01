'use client';

import { useEffect, useState } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';
import {
  ANNOUNCEMENT_CATEGORY_LABEL,
  listAnnouncements,
  markAllAnnouncementsRead,
  markAnnouncementRead,
  type Announcement
} from '@/lib/announcements';

type Filter = 'ALL' | 'UNREAD';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** HR/Admin receive every announcement from the API; show only what employees see. */
function isLive(a: Announcement, today: string): boolean {
  return a.status === 'ACTIVE' && !(a.use_end_date && a.end_date && a.end_date < today);
}

/**
 * Pengumuman card for the Employee / Management / GM dashboards: pinned first,
 * per-user read state, expand to read the full text (marks it read).
 */
export function AnnouncementFeed({ reloadKey = 0, className }: { reloadKey?: number; className?: string }) {
  const [items, setItems] = useState<Announcement[] | null>(null);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [marking, setMarking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listAnnouncements()
      .then((rows) => {
        const today = todayIso();
        if (!cancelled) setItems(rows.filter((a) => isLive(a, today)));
      })
      .catch(() => !cancelled && setItems([]));
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const setRead = (ids: number[] | 'all') =>
    setItems((prev) => prev?.map((a) => (ids === 'all' || ids.includes(a.id) ? { ...a, is_read: true } : a)) ?? prev);

  const toggle = (a: Announcement) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(a.id)) next.delete(a.id);
      else next.add(a.id);
      return next;
    });
    if (!a.is_read) {
      setRead([a.id]);
      markAnnouncementRead(a.id).catch(() => {});
    }
  };

  const markAll = async () => {
    setMarking(true);
    try {
      await markAllAnnouncementsRead();
      setRead('all');
    } finally {
      setMarking(false);
    }
  };

  const all = items ?? [];
  const unread = all.filter((a) => !a.is_read).length;
  const visible = filter === 'UNREAD' ? all.filter((a) => !a.is_read) : all;

  return (
    <Card className={cn('gap-0 overflow-hidden py-0', className)}>
      <div className='flex flex-wrap items-start justify-between gap-3 px-5 pt-5 pb-4'>
        <div className='flex items-center gap-3'>
          <span className='bg-primary/10 text-primary flex size-11 shrink-0 items-center justify-center rounded-xl'>
            <Icons.speakerphone className='size-5' />
          </span>
          <div>
            <h3 className='text-base font-semibold'>Pengumuman</h3>
            <p className='text-muted-foreground text-sm'>
              {items === null ? 'Memuat…' : unread > 0 ? `${unread} belum dibaca` : 'Semua sudah dibaca'}
            </p>
          </div>
        </div>
        {unread > 0 && (
          <button type='button' onClick={markAll} disabled={marking} className={buttonVariants({ variant: 'outline' })}>
            <Icons.checks className='size-4' />
            Tandai semua dibaca
          </button>
        )}
      </div>

      <div className='flex flex-wrap gap-2 px-5 pb-4'>
        {(
          [
            { value: 'ALL', label: 'Semua', count: all.length },
            { value: 'UNREAD', label: 'Belum dibaca', count: unread }
          ] as const
        ).map((t) => (
          <button
            key={t.value}
            type='button'
            onClick={() => setFilter(t.value)}
            className={cn(
              'rounded-lg border px-3.5 py-1.5 text-sm transition-colors',
              filter === t.value ? 'bg-foreground text-background border-foreground font-medium' : 'hover:bg-muted'
            )}
          >
            {t.label} · {t.count}
          </button>
        ))}
      </div>

      <div className='border-t'>
        {items === null ? (
          <div className='space-y-3 px-5 py-4'>
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className='h-16 w-full' />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className='px-5 py-10 text-center'>
            <p className='text-sm font-semibold'>
              {filter === 'UNREAD' && all.length > 0 ? 'Semua pengumuman sudah dibaca' : 'Belum ada pengumuman'}
            </p>
            <p className='text-muted-foreground mt-1 text-sm'>Pengumuman dari HR akan tampil di sini.</p>
          </div>
        ) : (
          <ul className='divide-y'>
            {visible.map((a) => {
              const expanded = open.has(a.id);
              return (
                <li key={a.id} className={cn(!a.is_read && 'bg-orange-50/60 dark:bg-orange-500/5')}>
                  <button
                    type='button'
                    onClick={() => toggle(a)}
                    aria-expanded={expanded}
                    className='hover:bg-muted/40 flex w-full items-start gap-4 px-5 py-4 text-left transition-colors'
                  >
                    <span
                      className={cn(
                        'flex size-9 shrink-0 items-center justify-center rounded-lg',
                        a.is_pinned
                          ? 'bg-orange-500/10 text-orange-700 dark:text-orange-300'
                          : 'bg-muted text-muted-foreground'
                      )}
                    >
                      {a.is_pinned ? <Icons.pin className='size-4' /> : <Icons.speakerphone className='size-4' />}
                    </span>
                    <span className='min-w-0 flex-1'>
                      <span className='flex flex-wrap items-center gap-x-2 gap-y-0.5'>
                        {!a.is_read && (
                          <span className='inline-flex items-center gap-1 text-[11px] font-bold tracking-wide text-orange-700 dark:text-orange-300'>
                            <span className='size-1.5 rounded-full bg-orange-600' />
                            BARU
                          </span>
                        )}
                        <span className='font-semibold'>{a.title}</span>
                      </span>
                      <span className='text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs'>
                        <span className='bg-muted text-foreground rounded px-1.5 py-0.5'>
                          {ANNOUNCEMENT_CATEGORY_LABEL[a.category] ?? 'Umum'}
                        </span>
                        {a.is_pinned && <span className='font-medium text-orange-700 dark:text-orange-300'>Disematkan</span>}
                        <span>HR · {fmtDate(a.created_at)} · untuk semua karyawan</span>
                      </span>
                      <span
                        className={cn('mt-2 block text-sm', expanded ? 'whitespace-pre-wrap' : 'line-clamp-1')}
                      >
                        {a.body}
                      </span>
                    </span>
                    <Icons.chevronDown
                      className={cn('text-muted-foreground mt-1 size-4 shrink-0 transition-transform', expanded && 'rotate-180')}
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}
