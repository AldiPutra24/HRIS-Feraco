'use client';

import { useMemo, useState } from 'react';
import { Icons } from '@/components/icons';
import { Input } from '@/components/ui/input';
import type { Skill } from '@/lib/freelance';

const NO_CATEGORY = 'Tanpa Kategori';

/**
 * Multi-select over the freelance Skill master (grouped by SkillCategory).
 * Shared by the freelance Job form and the public apply-form editor so both
 * read the same source (`listSkills`). Inactive skills are hidden unless
 * already selected (keeps existing data editable).
 */
export function SkillMultiSelect({
  skills,
  value,
  onChange
}: {
  skills: Skill[];
  value: number[];
  onChange: (next: number[]) => void;
}) {
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const map = new Map<string, Skill[]>();
    for (const s of skills) {
      if (!s.is_active && !value.includes(s.id)) continue;
      const category = s.category_name || NO_CATEGORY;
      if (q && !s.name.toLowerCase().includes(q) && !category.toLowerCase().includes(q)) continue;
      map.set(category, [...(map.get(category) ?? []), s]);
    }
    return [...map.entries()].sort(([a], [b]) =>
      a === NO_CATEGORY ? 1 : b === NO_CATEGORY ? -1 : a.localeCompare(b)
    );
  }, [skills, value, query]);

  function toggle(id: number) {
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  }

  if (skills.length === 0) {
    return (
      <p className='text-muted-foreground text-sm'>
        Belum ada skill. Tambahkan di menu Freelance (Skill & Kategori) terlebih dahulu.
      </p>
    );
  }

  return (
    <div className='space-y-2 rounded-lg border p-2.5'>
      <Input
        placeholder='Cari skill / kategori'
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className='h-8'
      />
      <div className='max-h-56 space-y-2.5 overflow-y-auto'>
        {groups.map(([category, items]) => (
          <div key={category}>
            <p className='text-muted-foreground mb-1 text-xs font-medium'>{category}</p>
            <div className='flex flex-wrap gap-1.5'>
              {items.map((s) => {
                const selected = value.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type='button'
                    onClick={() => toggle(s.id)}
                    className={`flex items-center gap-1 rounded-full border px-3 py-1 text-sm transition ${
                      selected ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-input hover:bg-muted'
                    }`}
                  >
                    {selected && <Icons.check className='h-3.5 w-3.5' />}
                    {s.name}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {groups.length === 0 && <p className='text-muted-foreground text-sm'>Tidak ada skill yang cocok.</p>}
      </div>
      <p className='text-muted-foreground text-xs'>{value.length} dipilih</p>
    </div>
  );
}
