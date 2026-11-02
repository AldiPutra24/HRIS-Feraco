'use client';

import { useCallback, useEffect, useState } from 'react';
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

const DISMISSED_KEY = 'announcement-banner-dismissed';

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

function readDismissed(): number | null {
  try {
    const v = window.localStorage.getItem(DISMISSED_KEY);
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}

export type AnnouncementFeedState = ReturnType<typeof useAnnouncementFeed>;

/**
 * Shared state for the banner + feed on the Employee / Management / GM
 * dashboards: pinned first (API order), per-user read state, expanded rows.
 */
export function useAnnouncementFeed(reloadKey = 0) {
  const [items, setItems] = useState<Announcement[] | null>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [dismissed, setDismissed] = useState<number | null>(null);

  useEffect(() => {
    setDismissed(readDismissed());
  }, []);

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

  const setRead = useCallback(
    (ids: number[] | 'all') =>
      setItems((prev) => prev?.map((a) => (ids === 'all' || ids.includes(a.id) ? { ...a, is_read: true } : a)) ?? prev),
    []
  );

  const markRead = useCallback(
    (a: Announcement) => {
      if (a.is_read) return;
      setRead([a.id]);
      markAnnouncementRead(a.id).catch(() => {});
    },
    [setRead]
  );

  const toggle = useCallback(
    (a: Announcement, force?: boolean) => {
      setOpen((prev) => {
        const next = new Set(prev);
        if (force ?? !next.has(a.id)) next.add(a.id);
        else next.delete(a.id);
        return next;
      });
      markRead(a);
    },
    [markRead]
  );

  const markAll = useCallback(async () => {
    await markAllAnnouncementsRead();
    setRead('all');
  }, [setRead]);

  /** Hide the banner for this announcement only (it stays unread in the feed). */
  const dismiss = useCallback((id: number) => {
    setDismissed(id);
    try {
      window.localStorage.setItem(DISMISSED_KEY, String(id));
    } catch {
      // Private mode / blocked storage: dismissal lasts for this page view.
    }
  }, []);

  return { items, open, toggle, markAll, dismissed, dismiss };
}

/** Green "Pengumuman baru" banner: the first unread announcement (pinned first). */
export function AnnouncementBanner({ feed }: { feed: AnnouncementFeedState }) {
  const unread = (feed.items ?? []).filter((a) => !a.is_read);
  const top = unread[0];
  if (!top || top.id === feed.dismissed) return null;

  const readMore = () => {
    feed.toggle(top, true);
    document.getElementById(`announcement-${top.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <section
      aria-label='Pengumuman baru'
      className='bg-primary text-primary-foreground relative overflow-hidden rounded-2xl px-5 py-5 md:px-6'
    >
      <Icons.speakerphone
        aria-hidden
        className='pointer-events-none absolute -right-4 top-1/2 size-40 -translate-y-1/2 opacity-10'
      />
      <div className='relative flex flex-col gap-4 md:flex-row md:items-center'>
        <span className='relative flex size-12 shrink-0 items-center justify-center rounded-xl bg-white/15'>
          <Icons.speakerphone className='size-5' />
          <span className='absolute -top-1 -right-1 size-2.5 rounded-full bg-orange-400' />
        </span>
        <div className='min-w-0 flex-1'>
          <p className='flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs'>
            <span className='bg-background text-primary rounded-full px-2.5 py-0.5 font-bold tracking-wide'>
              PENGUMUMAN BARU
            </span>
            {top.is_pinned && (
              <span className='inline-flex items-center gap-1 font-semibold'>
                <Icons.pin className='size-3.5' />
                Disematkan
              </span>
            )}
            <span className='opacity-90'>
              {ANNOUNCEMENT_CATEGORY_LABEL[top.category] ?? 'Umum'} · HR · {fmtDate(top.created_at)}
            </span>
          </p>
          <p className='mt-1.5 truncate text-lg font-semibold'>{top.title}</p>
          <p className='line-clamp-1 text-sm opacity-90'>{top.body}</p>
          {unread.length > 1 && (
            <p className='mt-1 text-xs font-semibold'>+{unread.length - 1} pengumuman lain belum dibaca</p>
          )}
        </div>
        <div className='flex shrink-0 items-center gap-2'>
          <button
            type='button'
            onClick={readMore}
            className='bg-background text-foreground hover:bg-background/90 inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors'
          >
            Baca selengkapnya
            <Icons.arrowRight className='size-4' />
          </button>
          <button
            type='button'
            onClick={() => feed.dismiss(top.id)}
            aria-label='Tutup banner'
            title='Tutup'
            className='flex size-10 items-center justify-center rounded-lg border border-white/30 transition-colors hover:bg-white/10'
          >
            <Icons.close className='size-4' />
          </button>
        </div>
      </div>
    </section>
  );
}

/** Pengumuman card: filter, mark-all, expand to read the full text (marks it read). */
export function AnnouncementFeed({ feed, className }: { feed: AnnouncementFeedState; className?: string }) {
  const [filter, setFilter] = useState<Filter>('ALL');
  const [marking, setMarking] = useState(false);
  const { items, open, toggle } = feed;

  const markAll = async () => {
    setMarking(true);
    try {
      await feed.markAll();
    } finally {
      setMarking(false);
    }
  };

  const all = items ?? [];
  const unread = all.filter((a) => !a.is_read).length;
  const visible = filter === 'UNREAD' ? all.filter((a) => !a.is_read) : all;

  return (
    <Card
      className={cn(
        'gap-0 overflow-hidden py-0',
        unread > 0 && 'border-primary/30 ring-primary/20',
        className
      )}
    >
      <div className={cn(unread > 0 && 'bg-primary/5')}>
        <div className='flex flex-wrap items-start justify-between gap-3 px-5 pt-5 pb-4'>
          <div className='flex items-center gap-3'>
            <span className='bg-primary/10 text-primary flex size-11 shrink-0 items-center justify-center rounded-xl'>
              <Icons.speakerphone className='size-5' />
            </span>
            <div>
              <h3 className='flex items-center gap-2 text-base font-semibold'>
                Pengumuman
                {unread > 0 && (
                  <span className='rounded-full bg-orange-700 px-2 py-0.5 text-xs font-semibold text-white'>
                    {unread} baru
                  </span>
                )}
              </h3>
              <p className='text-muted-foreground text-sm'>
                {items === null ? 'Memuat…' : unread > 0 ? `${unread} belum dibaca` : 'Semua sudah dibaca'}
              </p>
            </div>
          </div>
          {unread > 0 && (
            <button
              type='button'
              onClick={markAll}
              disabled={marking}
              className={cn(buttonVariants({ variant: 'outline' }), 'bg-background')}
            >
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
                filter === t.value
                  ? 'bg-foreground text-background border-foreground font-medium'
                  : 'bg-background hover:bg-muted'
              )}
            >
              {t.label} · {t.count}
            </button>
          ))}
        </div>
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
                <li
                  key={a.id}
                  id={`announcement-${a.id}`}
                  className={cn('scroll-mt-24', !a.is_read && 'bg-orange-50/60 dark:bg-orange-500/5')}
                >
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
                      <span className={cn('mt-2 block text-sm', expanded ? 'whitespace-pre-wrap' : 'line-clamp-1')}>
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
