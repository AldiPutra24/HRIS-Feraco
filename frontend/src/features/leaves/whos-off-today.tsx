'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';
import { getWhosOffToday, type OffTodayCategory, type OffTodayItem } from '@/lib/leaves';

type Filter = 'ALL' | OffTodayCategory;

const CATEGORY: Record<OffTodayCategory, { label: string; badge: string; icon: keyof typeof Icons; iconTone: string }> = {
  ANNUAL: {
    label: 'Cuti Tahunan',
    badge: 'bg-rose-500/10 text-rose-600 dark:text-rose-300',
    icon: 'sun',
    iconTone: 'text-emerald-500'
  },
  SICK: {
    label: 'Sakit',
    badge: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
    icon: 'plusCircle',
    iconTone: 'text-sky-600'
  },
  OTHER: {
    label: 'Lainnya',
    badge: 'bg-muted text-muted-foreground',
    icon: 'calendar',
    iconTone: 'text-primary'
  }
};

function fmtDay(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}

function dateRange(item: OffTodayItem): string {
  return item.start_date === item.end_date
    ? fmtDay(item.start_date)
    : `${fmtDay(item.start_date)} – ${fmtDay(item.end_date)}`;
}

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

/**
 * "Who's Off Today": who is on approved izin/cuti today, filterable by
 * category. Shown on every dashboard (HR, GM, Management, Employee); the
 * backend exposes only name / department / category / dates.
 */
export function WhosOffToday({ href, className }: { href?: string; className?: string }) {
  const [items, setItems] = useState<OffTodayItem[] | null>(null);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<Filter>('ALL');

  useEffect(() => {
    getWhosOffToday()
      .then((d) => setItems(d.results))
      .catch(() => setError(true));
  }, []);

  const count = (f: Filter) => (items ?? []).filter((i) => f === 'ALL' || i.category === f).length;
  const tabs: { value: Filter; label: string }[] = [
    { value: 'ALL', label: 'Semua' },
    { value: 'ANNUAL', label: CATEGORY.ANNUAL.label },
    { value: 'SICK', label: CATEGORY.SICK.label },
    { value: 'OTHER', label: CATEGORY.OTHER.label }
  ];
  const visible = (items ?? []).filter((i) => filter === 'ALL' || i.category === filter);

  return (
    <Card className={cn('gap-0 py-0', className)}>
      <div className='flex items-center justify-between gap-2 px-5 pt-4 pb-3'>
        <div className='flex items-center gap-2.5'>
          <span className='bg-primary/10 text-primary flex size-9 items-center justify-center rounded-lg'>
            <Icons.leave className='size-5' />
          </span>
          <div>
            <h3 className='text-base font-semibold'>Who&apos;s Off Today</h3>
            <p className='text-muted-foreground text-xs'>Izin &amp; cuti yang disetujui hari ini</p>
          </div>
        </div>
        {href && (
          <Link href={href} className='text-primary inline-flex shrink-0 items-center gap-1 text-xs font-medium hover:underline'>
            Lihat Semua
            <Icons.arrowRight className='size-3.5' />
          </Link>
        )}
      </div>

      <div className='flex gap-1.5 overflow-x-auto px-5 pb-3'>
        {tabs.map((t) => (
          <button
            key={t.value}
            type='button'
            onClick={() => setFilter(t.value)}
            className={cn(
              'shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
              filter === t.value
                ? 'border-primary/30 bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-muted bg-transparent'
            )}
          >
            {t.label} ({items ? count(t.value) : '–'})
          </button>
        ))}
      </div>

      <CardContent className='border-t px-0 pb-1'>
        {error ? (
          <p className='text-muted-foreground px-5 py-8 text-center text-sm'>Gagal memuat data.</p>
        ) : items === null ? (
          <div className='space-y-3 px-5 py-4'>
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className='h-12 w-full' />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className='text-muted-foreground flex flex-col items-center gap-2 px-5 py-8 text-center text-sm'>
            <Icons.circleCheck className='size-6 text-emerald-500' />
            {items.length === 0 ? 'Semua hadir hari ini.' : 'Tidak ada untuk kategori ini.'}
          </div>
        ) : (
          <ul className='max-h-96 divide-y overflow-y-auto'>
            {visible.map((item) => {
              const cat = CATEGORY[item.category];
              const CatIcon = Icons[cat.icon];
              return (
                <li key={item.id} className='flex items-center gap-3 px-5 py-3'>
                  {item.photo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.photo_url} alt={item.employee_name} className='size-10 shrink-0 rounded-full object-cover' />
                  ) : (
                    <span className='bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold'>
                      {initials(item.employee_name)}
                    </span>
                  )}
                  <div className='min-w-0 flex-1'>
                    <p className='truncate text-sm font-medium'>{item.employee_name}</p>
                    <p className='text-muted-foreground truncate text-xs'>{item.department_name || '-'}</p>
                  </div>
                  <div className='flex min-w-0 shrink-0 flex-col items-start gap-1'>
                    <span
                      className={cn('max-w-36 truncate rounded-full px-2 py-0.5 text-[11px] font-medium', cat.badge)}
                      title={item.leave_type_name}
                    >
                      {item.leave_type_name}
                    </span>
                    <span className='text-muted-foreground text-xs'>
                      {dateRange(item)}
                      {item.half_day ? ' · ½ hari' : ''}
                    </span>
                  </div>
                  <CatIcon className={cn('size-5 shrink-0', cat.iconTone)} aria-hidden />
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
