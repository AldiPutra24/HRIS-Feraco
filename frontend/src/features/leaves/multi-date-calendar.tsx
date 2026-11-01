'use client';

import { useState } from 'react';
import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';

const WEEKDAYS = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
const MONTHS = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/** Local YYYY-MM-DD (no timezone shift from toISOString). */
function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function formatIsoShort(value: string): string {
  const [y, m, d] = value.split('-').map(Number);
  return `${String(d).padStart(2, '0')} ${MONTHS_SHORT[m - 1]} ${y}`;
}

const navClass =
  'border-border hover:bg-muted flex size-9 items-center justify-center rounded-lg border bg-background transition-colors';

/**
 * Month calendar where each day toggles independently, so non-consecutive
 * leave days (01, 02, 05 Sep) can be picked. Value = sorted ISO dates.
 */
export function MultiDateCalendar({
  value,
  onChange,
  minDate
}: {
  value: string[];
  onChange: (next: string[]) => void;
  /** ISO date; earlier days are disabled (no backdate). */
  minDate?: string;
}) {
  const today = new Date();
  const first = value[0] ? value[0].split('-').map(Number) : null;
  const [cursor, setCursor] = useState(() =>
    first ? { y: first[0], m: first[1] - 1 } : { y: today.getFullYear(), m: today.getMonth() }
  );
  const todayIso = iso(today.getFullYear(), today.getMonth(), today.getDate());

  const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate();
  // Monday-first offset (getDay: 0=Sun).
  const offset = (new Date(cursor.y, cursor.m, 1).getDay() + 6) % 7;
  const cells: (number | null)[] = [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1)
  ];

  function shift(delta: number) {
    setCursor(({ y, m }) => {
      const n = m + delta;
      return { y: y + Math.floor(n / 12), m: ((n % 12) + 12) % 12 };
    });
  }

  function toggle(day: number) {
    const key = iso(cursor.y, cursor.m, day);
    const next = value.includes(key) ? value.filter((v) => v !== key) : [...value, key];
    onChange(next.sort());
  }

  return (
    <div className='w-full rounded-xl border p-4'>
      <div className='mb-3 flex items-center justify-between'>
        <button type='button' className={navClass} onClick={() => shift(-1)} aria-label='Bulan sebelumnya'>
          <Icons.chevronLeft className='size-4' />
        </button>
        <span className='text-base font-semibold'>
          {MONTHS[cursor.m]} {cursor.y}
        </span>
        <button type='button' className={navClass} onClick={() => shift(1)} aria-label='Bulan berikutnya'>
          <Icons.chevronRight className='size-4' />
        </button>
      </div>
      <div className='grid grid-cols-7 gap-1.5 text-center'>
        {WEEKDAYS.map((w, i) => (
          <span key={w} className={cn('py-1.5 text-xs font-medium', i >= 5 ? 'text-orange-600' : 'text-muted-foreground')}>
            {w}
          </span>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <span key={`blank-${i}`} />;
          const key = iso(cursor.y, cursor.m, day);
          const selected = value.includes(key);
          const disabled = !!minDate && key < minDate;
          const isToday = key === todayIso;
          return (
            <button
              key={key}
              type='button'
              onClick={() => toggle(day)}
              aria-pressed={selected}
              aria-current={isToday ? 'date' : undefined}
              disabled={disabled}
              className={cn(
                'h-10 rounded-lg border text-sm tabular-nums transition-colors',
                disabled
                  ? 'text-muted-foreground/40 cursor-not-allowed border-transparent'
                  : selected
                    ? 'bg-primary border-primary text-primary-foreground font-semibold'
                    : isToday
                      ? 'border-foreground font-medium hover:bg-muted'
                      : 'border-border/70 hover:bg-muted'
              )}
            >
              {day}
            </button>
          );
        })}
      </div>
      <div className='text-muted-foreground mt-3 flex items-center gap-4 text-xs'>
        <span className='flex items-center gap-1.5'>
          <span className='bg-primary size-3 rounded-sm' /> Dipilih
        </span>
        <span className='flex items-center gap-1.5'>
          <span className='border-foreground size-3 rounded-sm border' /> Hari ini
        </span>
      </div>
    </div>
  );
}
