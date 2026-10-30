'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { listJobs, listTalentProfiles, type Job, type TalentProfile } from '@/lib/recruitment';
import { ALL_STATUSES, statusLabel } from '@/features/recruitment/candidate-pipeline';
import {
  AVAILABILITY_LABELS,
  EMPLOYMENT_STATUS_LABELS,
  EMPLOYMENT_TYPE_LABELS,
  SOURCE_REPORTED_LABELS,
  label
} from '@/features/recruitment/talent-pool-labels';

const selectClass = 'border-input h-9 w-full rounded-lg border bg-transparent px-2.5 text-sm';
const PAGE_SIZE = 20;

const SELECT_FILTERS: { key: string; title: string; options: Record<string, string> }[] = [
  { key: 'employment_type', title: 'Employment Type', options: EMPLOYMENT_TYPE_LABELS },
  { key: 'availability', title: 'Availability', options: AVAILABILITY_LABELS },
  { key: 'employment_status', title: 'Status Pekerjaan', options: EMPLOYMENT_STATUS_LABELS },
  { key: 'source_reported', title: 'Sumber', options: SOURCE_REPORTED_LABELS }
];

function fmtDate(v: string): string {
  return new Date(v).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Talent Pool: one row per person (CandidateProfile), PRD §5.7 filters. */
export function TalentPoolPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [rows, setRows] = useState<TalentProfile[] | null>(null);
  const [count, setCount] = useState(0);
  const [error, setError] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [search, setSearch] = useState(searchParams.get('search') ?? '');
  const query = searchParams.toString();
  const page = Number(searchParams.get('page') ?? '1');

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams);
    if (value) params.set(key, value);
    else params.delete(key);
    if (key !== 'page') params.delete('page');
    router.replace(`${pathname}${params.size ? `?${params}` : ''}`);
  }

  useEffect(() => {
    listJobs()
      .then(setJobs)
      .catch(() => setJobs([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(false);
    listTalentProfiles(Object.fromEntries(new URLSearchParams(query)))
      .then((d) => {
        if (cancelled) return;
        setRows(d.results);
        setCount(d.count);
      })
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [query]);

  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  return (
    <div className='flex flex-1 flex-col gap-4 p-4 md:p-6'>
      <div className='flex flex-wrap items-end justify-between gap-3'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>Talent Pool</h2>
          <p className='text-muted-foreground text-sm'>
            Database kandidat in-house &amp; freelance — satu orang, satu profil, banyak lamaran.
          </p>
        </div>
        <div className='flex flex-wrap gap-2'>
          <Button
            size='sm'
            variant={searchParams.get('duplicates') === '1' ? 'default' : 'outline'}
            onClick={() => setParam('duplicates', searchParams.get('duplicates') === '1' ? '' : '1')}
          >
            Kemungkinan duplikat
          </Button>
          <Button
            size='sm'
            variant={searchParams.get('needs_review') === '1' ? 'default' : 'outline'}
            onClick={() => setParam('needs_review', searchParams.get('needs_review') === '1' ? '' : '1')}
          >
            Perlu ditinjau (24 bln)
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className='grid gap-3 md:grid-cols-4'>
          <form
            className='md:col-span-2'
            onSubmit={(e) => {
              e.preventDefault();
              setParam('search', search.trim());
            }}
          >
            <Label className='text-xs'>Cari</Label>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder='Nama, email, telepon, kota, ID kandidat…'
            />
          </form>
          <div>
            <Label className='text-xs'>Lokasi</Label>
            <Input
              key={searchParams.get('location') ?? ''}
              defaultValue={searchParams.get('location') ?? ''}
              placeholder='Kota'
              onBlur={(e) => setParam('location', e.target.value.trim())}
            />
          </div>
          <div>
            <Label className='text-xs'>Posisi</Label>
            <select className={selectClass} value={searchParams.get('job') ?? ''} onChange={(e) => setParam('job', e.target.value)}>
              <option value=''>Semua</option>
              <option value='open'>Open Application</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.title}
                </option>
              ))}
            </select>
          </div>
          {SELECT_FILTERS.map((f) => (
            <div key={f.key}>
              <Label className='text-xs'>{f.title}</Label>
              <select className={selectClass} value={searchParams.get(f.key) ?? ''} onChange={(e) => setParam(f.key, e.target.value)}>
                <option value=''>Semua</option>
                {Object.entries(f.options).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
          ))}
          <div>
            <Label className='text-xs'>Status Lamaran</Label>
            <select className={selectClass} value={searchParams.get('status') ?? ''} onChange={(e) => setParam('status', e.target.value)}>
              <option value=''>Semua</option>
              {ALL_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {statusLabel(s)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label className='text-xs'>Daftar dari</Label>
            <Input
              type='date'
              value={searchParams.get('registered_from') ?? ''}
              onChange={(e) => setParam('registered_from', e.target.value)}
            />
          </div>
          <div>
            <Label className='text-xs'>Daftar sampai</Label>
            <Input
              type='date'
              value={searchParams.get('registered_to') ?? ''}
              onChange={(e) => setParam('registered_to', e.target.value)}
            />
          </div>
          <div className='flex items-end'>
            <Button
              variant='ghost'
              onClick={() => {
                setSearch('');
                router.replace(pathname);
              }}
            >
              Reset filter
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className='gap-0 py-0'>
        {error ? (
          <p className='text-muted-foreground p-6 text-center text-sm'>Gagal memuat Talent Pool.</p>
        ) : rows === null ? (
          <div className='space-y-2 p-4'>
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className='h-12 w-full' />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className='text-muted-foreground p-6 text-center text-sm'>Tidak ada kandidat yang cocok.</p>
        ) : (
          <div className='overflow-x-auto'>
            <table className='w-full text-sm'>
              <thead className='text-muted-foreground border-b text-left text-xs'>
                <tr>
                  <th className='px-4 py-3 font-medium'>Kandidat</th>
                  <th className='px-4 py-3 font-medium'>Minat</th>
                  <th className='px-4 py-3 font-medium'>Availability</th>
                  <th className='px-4 py-3 font-medium'>Lamaran terakhir</th>
                  <th className='px-4 py-3 font-medium'>Aktivitas</th>
                </tr>
              </thead>
              <tbody className='divide-y'>
                {rows.map((p) => (
                  <tr key={p.id} className='hover:bg-muted/40'>
                    <td className='px-4 py-3'>
                      <Link href={`/dashboard/recruitment/talent-pool/${p.id}`} className='font-medium hover:underline'>
                        {p.full_name}
                      </Link>
                      <p className='text-muted-foreground text-xs'>
                        {p.code} · {p.email}
                        {p.city ? ` · ${p.city}` : ''}
                      </p>
                      <div className='mt-1 flex flex-wrap gap-1'>
                        {p.possible_duplicate_code && (
                          <Badge variant='outline' className='border-amber-400 text-amber-700'>
                            Mirip {p.possible_duplicate_code}
                          </Badge>
                        )}
                        {p.freelancer && <Badge variant='secondary'>Freelancer</Badge>}
                        {p.employee && <Badge variant='secondary'>Karyawan</Badge>}
                        {p.anonymized_at && <Badge variant='outline'>Dianonimkan</Badge>}
                      </div>
                    </td>
                    <td className='text-muted-foreground px-4 py-3 text-xs'>
                      {p.employment_types.length ? p.employment_types.map((t) => label(EMPLOYMENT_TYPE_LABELS, t)).join(', ') : '-'}
                    </td>
                    <td className='text-muted-foreground px-4 py-3 text-xs'>{label(AVAILABILITY_LABELS, p.availability)}</td>
                    <td className='px-4 py-3'>
                      {p.latest_application ? (
                        <>
                          <p className='text-xs'>{p.latest_application.job_title ?? 'Open Application'}</p>
                          <Badge variant={p.latest_application.status === 'INACTIVE' ? 'outline' : 'default'} className='mt-1'>
                            {statusLabel(p.latest_application.status)}
                          </Badge>
                          {p.applications_count > 1 && (
                            <span className='text-muted-foreground ml-1 text-xs'>+{p.applications_count - 1} lainnya</span>
                          )}
                        </>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className='text-muted-foreground px-4 py-3 text-xs whitespace-nowrap'>
                      {fmtDate(p.last_activity)}
                      <p>Daftar {fmtDate(p.created_at)}</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rows && rows.length > 0 && (
          <div className='text-muted-foreground flex items-center justify-between border-t px-4 py-3 text-xs'>
            <span>{count} kandidat unik</span>
            <div className='flex items-center gap-2'>
              <Button size='sm' variant='outline' disabled={page <= 1} onClick={() => setParam('page', String(page - 1))}>
                Sebelumnya
              </Button>
              <span>
                {page} / {pages}
              </span>
              <Button size='sm' variant='outline' disabled={page >= pages} onClick={() => setParam('page', String(page + 1))}>
                Berikutnya
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
