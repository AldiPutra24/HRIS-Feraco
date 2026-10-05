'use client';

import { useState } from 'react';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
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
    <div className='w-full max-w-sm rounded-lg border p-3'>
      <div className='mb-2 flex items-center justify-between'>
        <Button type='button' variant='ghost' size='sm' onClick={() => shift(-1)} aria-label='Bulan sebelumnya'>
          <Icons.chevronLeft className='size-4' />
        </Button>
        <span className='text-sm font-medium'>
          {MONTHS[cursor.m]} {cursor.y}
        </span>
        <Button type='button' variant='ghost' size='sm' onClick={() => shift(1)} aria-label='Bulan berikutnya'>
          <Icons.chevronRight className='size-4' />
        </Button>
      </div>
      <div className='grid grid-cols-7 gap-1 text-center'>
        {WEEKDAYS.map((w) => (
          <span key={w} className='text-muted-foreground py-1 text-xs font-medium'>
            {w}
          </span>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <span key={`blank-${i}`} />;
          const key = iso(cursor.y, cursor.m, day);
          const selected = value.includes(key);
          const disabled = !!minDate && key < minDate;
          return (
            <button
              key={key}
              type='button'
              onClick={() => toggle(day)}
              aria-pressed={selected}
              disabled={disabled}
              className={cn(
                'h-8 rounded-md text-sm transition-colors',
                disabled && 'text-muted-foreground/40 cursor-not-allowed',
                selected ? 'bg-primary text-primary-foreground font-semibold' : !disabled && 'hover:bg-muted',
                !selected && key === todayIso && 'border-primary border'
              )}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
