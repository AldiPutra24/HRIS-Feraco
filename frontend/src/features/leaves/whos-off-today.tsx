'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';
import { getWhosOffToday, type OffTodayCategory, type OffTodayFilter, type OffTodayItem } from '@/lib/leaves';

type Filter = 'ALL' | OffTodayCategory;

const CATEGORY: Record<OffTodayCategory, { label: string; icon: keyof typeof Icons; iconTone: string }> = {
  ANNUAL: { label: 'Cuti Tahunan', icon: 'vacation', iconTone: 'text-rose-500' },
  SICK: { label: 'Sakit', icon: 'sick', iconTone: 'text-sky-600' },
  OTHER: { label: 'Lainnya', icon: 'event', iconTone: 'text-muted-foreground' }
};

function parse(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}

function fmtDay(d: Date, withMonth = true): string {
  return withMonth ? d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) : String(d.getDate());
}

/** "27 – 29 Okt", "29 Okt – 2 Nov" or "29 Okt". */
function dateRange(item: OffTodayItem): string {
  const s = parse(item.start_date);
  const e = parse(item.end_date);
  if (item.start_date === item.end_date) return fmtDay(s);
  return `${fmtDay(s, s.getMonth() !== e.getMonth())} – ${fmtDay(e)}`;
}

/** "Hari terakhir" when the leave ends today, else the next weekday after it. */
function returnLabel(item: OffTodayItem, today: string): string {
  if (item.end_date <= today) return 'Hari terakhir';
  const d = parse(item.end_date);
  do d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6);
  return `Kembali ${fmtDay(d)}`;
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
export function WhosOffToday({
  href,
  className,
  description = 'Izin & cuti yang disetujui hari ini',
  wide = false,
  scope,
  onLoaded
}: {
  href?: string;
  className?: string;
  description?: string;
  /** Wide card: tabs beside the title and a two-column list. */
  wide?: boolean;
  /** Department / position filter (HR overview). */
  scope?: OffTodayFilter;
  /** Lets a dashboard reuse the same data (e.g. a "Sedang Cuti" stat card). */
  onLoaded?: (items: OffTodayItem[]) => void;
}) {
  const [items, setItems] = useState<OffTodayItem[] | null>(null);
  const [today, setToday] = useState('');
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<Filter>('ALL');

  const department = scope?.department ?? null;
  const position = scope?.position ?? null;

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setError(false);
    getWhosOffToday({ department, position })
      .then((d) => {
        if (cancelled) return;
        setItems(d.results);
        setToday(d.date);
        onLoaded?.(d.results);
      })
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [department, position]);

  const count = (f: Filter) => (items ?? []).filter((i) => f === 'ALL' || i.category === f).length;
  const tabs: { value: Filter; label: string }[] = [
    { value: 'ALL', label: 'Semua' },
    { value: 'ANNUAL', label: CATEGORY.ANNUAL.label },
    { value: 'SICK', label: CATEGORY.SICK.label },
    { value: 'OTHER', label: CATEGORY.OTHER.label }
  ];
  const visible = (items ?? []).filter((i) => filter === 'ALL' || i.category === filter);

  const tabBar = (
    <div className='flex flex-wrap gap-1.5'>
      {tabs.map((t) => (
        <button
          key={t.value}
          type='button'
          onClick={() => setFilter(t.value)}
          className={cn(
            'rounded-lg border px-3 py-1.5 text-sm whitespace-nowrap transition-colors',
            filter === t.value
              ? 'bg-foreground text-background border-foreground font-medium'
              : 'hover:bg-muted bg-transparent'
          )}
        >
          {t.label} <span className={cn(filter !== t.value && 'text-muted-foreground')}>{items ? count(t.value) : '–'}</span>
        </button>
      ))}
    </div>
  );

  return (
    <Card className={cn('gap-0 py-0', className)}>
      <div className='flex flex-wrap items-start justify-between gap-x-4 gap-y-3 px-5 pt-5 pb-4'>
        <div>
          <h3 className='text-base font-semibold'>Who&apos;s Off Today</h3>
          <p className='text-muted-foreground text-sm'>{description}</p>
        </div>
        {href && (
          <Link href={href} className='inline-flex shrink-0 items-center gap-1 text-sm font-medium hover:underline'>
            Lihat semua
            <Icons.arrowRight className='size-4' />
          </Link>
        )}
        {wide && tabBar}
      </div>

      {!wide && <div className='px-5 pb-4'>{tabBar}</div>}

      <div className='border-t'>
        {error ? (
          <p className='text-muted-foreground px-5 py-8 text-center text-sm'>Gagal memuat data.</p>
        ) : items === null ? (
          <div className='space-y-3 px-5 py-4'>
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className='h-12 w-full' />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className='text-muted-foreground flex flex-col items-center gap-2 px-5 py-8 text-center text-sm'>
            <Icons.circleCheck className='size-6 text-emerald-500' />
            {items.length === 0 ? 'Semua hadir hari ini.' : 'Tidak ada untuk kategori ini.'}
          </div>
        ) : (
          <ul
            className={cn(
              'max-h-96 overflow-y-auto',
              wide ? 'grid divide-y md:grid-cols-2 md:gap-x-10 md:divide-y-0 md:px-5' : 'divide-y border-b'
            )}
          >
            {visible.map((item) => {
              const cat = CATEGORY[item.category];
              const CatIcon = Icons[cat.icon];
              return (
                <li key={item.id} className={cn('flex items-center gap-3 py-3.5', wide ? 'px-5 md:px-0' : 'px-5')}>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <span
                          tabIndex={0}
                          aria-label={`${item.employee_name} · ${cat.label}`}
                          className='relative shrink-0 cursor-help'
                        />
                      }
                    >
                      {item.photo_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.photo_url} alt='' className='size-10 rounded-full object-cover' />
                      ) : (
                        <span className='bg-primary/10 text-primary flex size-10 items-center justify-center rounded-full text-sm font-semibold'>
                          {initials(item.employee_name)}
                        </span>
                      )}
                      <span className='bg-card ring-card absolute -right-1 -bottom-1 flex size-5 items-center justify-center rounded-full ring-2'>
                        <CatIcon className={cn('size-3.5', cat.iconTone)} aria-hidden />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side='top'>
                      {cat.label === item.leave_type_name ? cat.label : `${cat.label} · ${item.leave_type_name}`}
                    </TooltipContent>
                  </Tooltip>
                  <div className='min-w-0 flex-1'>
                    <p className='truncate text-sm font-medium'>{item.employee_name}</p>
                    <p className='text-muted-foreground truncate text-xs'>
                      {item.department_name || '-'} · {item.leave_type_name}
                    </p>
                  </div>
                  <div className='shrink-0 text-right'>
                    <p className='text-sm font-medium tabular-nums'>{dateRange(item)}</p>
                    <p className='text-muted-foreground text-xs'>
                      {item.half_day ? '½ hari · ' : ''}
                      {returnLabel(item, today)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}
