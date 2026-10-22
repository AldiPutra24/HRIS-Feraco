'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AllQuotaTable } from '@/features/leaves/all-quota-table';

/** "Sisa Kuota Cuti" table (same as HR) — scope enforced by the backend. */
export function TeamQuotaCard({ title, description, emptyText }: { title: string; description: string; emptyText: string }) {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  return (
    <Card>
      <CardHeader className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:space-y-0'>
        <div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <select
          aria-label='Pilih tahun'
          className='border-input h-9 rounded-lg border bg-transparent px-2.5 text-sm'
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
        >
          {[thisYear - 1, thisYear, thisYear + 1].map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </CardHeader>
      <CardContent>
        <AllQuotaTable year={year} emptyText={emptyText} />
      </CardContent>
    </Card>
  );
}
