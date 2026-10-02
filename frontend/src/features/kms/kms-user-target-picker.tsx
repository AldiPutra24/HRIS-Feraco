'use client';

/**
 * Searchable multi-select for KMS "User Tertentu" visibility. Options are
 * employees with an active account, shown as "Nama Karyawan - Posisi";
 * the stored value is the User ID (never the name), so renames or position
 * changes never break targeting. Search runs server-side (scales to many
 * employees).
 */

import { useEffect, useRef, useState } from 'react';
import { Icons } from '@/components/icons';
import { Input } from '@/components/ui/input';
import { searchKmsUserTargets, type KmsUserTargetOption } from '@/lib/kms';
import { cn } from '@/lib/utils';

type Props = {
  value: number[];
  initialOptions: KmsUserTargetOption[];
  onChange: (next: number[]) => void;
};

export function KmsUserTargetPicker({ value, initialOptions, onChange }: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<KmsUserTargetOption[]>([]);
  const [loading, setLoading] = useState(false);
  // Labels for selected IDs (seeded from the article, extended on pick).
  const [known, setKnown] = useState<Record<number, KmsUserTargetOption>>(() =>
    Object.fromEntries(initialOptions.map((o) => [o.id, o])),
  );
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const handle = window.setTimeout(() => {
      setLoading(true);
      searchKmsUserTargets(query.trim())
        .then((rows) => {
          if (!cancelled) setOptions(rows);
        })
        .catch(() => {
          if (!cancelled) setOptions([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [query, open]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  function toggle(option: KmsUserTargetOption) {
    setKnown((prev) => ({ ...prev, [option.id]: option }));
    onChange(value.includes(option.id) ? value.filter((id) => id !== option.id) : [...value, option.id]);
  }

  return (
    <div ref={boxRef} className='space-y-2'>
      {value.length > 0 && (
        <div className='flex flex-wrap gap-1.5'>
          {value.map((id) => (
            <span
              key={id}
              className='bg-primary/10 text-primary flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium'
            >
              {known[id]?.label ?? `User #${id}`}
              <button
                type='button'
                aria-label='Hapus target'
                onClick={() => onChange(value.filter((x) => x !== id))}
                className='hover:text-foreground'
              >
                <Icons.close className='size-3' />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className='relative'>
        <Input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder='Cari nama karyawan / posisi...'
          aria-label='Cari karyawan'
        />
        {open && (
          <div className='bg-popover absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border shadow-md'>
            {loading && <p className='text-muted-foreground px-3 py-2 text-sm'>Memuat...</p>}
            {!loading && options.length === 0 && (
              <p className='text-muted-foreground px-3 py-2 text-sm'>Karyawan tidak ditemukan.</p>
            )}
            {!loading &&
              options.map((o) => {
                const selected = value.includes(o.id);
                return (
                  <button
                    key={o.id}
                    type='button'
                    onClick={() => toggle(o)}
                    className={cn(
                      'hover:bg-muted flex w-full items-center justify-between px-3 py-2 text-left text-sm',
                      selected && 'font-medium',
                    )}
                  >
                    <span>
                      {o.name}
                      {o.position && <span className='text-muted-foreground'> - {o.position}</span>}
                    </span>
                    {selected && <Icons.check className='text-primary size-4' />}
                  </button>
                );
              })}
          </div>
        )}
      </div>
      <p className='text-muted-foreground text-xs'>{value.length} karyawan dipilih</p>
    </div>
  );
}
