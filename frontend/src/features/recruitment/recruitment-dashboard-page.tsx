'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  getPipelineDashboard,
  getTalentPoolDashboard,
  listJobs,
  type CountRow,
  type Job,
  type PipelineDashboard,
  type TalentPoolDashboard
} from '@/lib/recruitment';
import { PIPELINE, statusLabel } from '@/features/recruitment/candidate-pipeline';
import { EMPLOYMENT_TYPE_LABELS, TRACK_LABELS, label } from '@/features/recruitment/talent-pool-labels';

const selectClass = 'border-input h-9 w-full rounded-lg border bg-transparent px-2.5 text-sm';
const STATUS_COLUMNS = [...PIPELINE, 'INACTIVE'];

function Stat({ title, value, hint, href }: { title: string; value: number; hint: string; href?: string }) {
  const body = (
    <Card className='h-full gap-1 py-4 transition-colors hover:bg-muted/30'>
      <CardContent className='space-y-1 px-4'>
        <p className='text-muted-foreground text-xs'>{title}</p>
        <p className='text-3xl font-semibold tabular-nums'>{value.toLocaleString('id-ID')}</p>
        <p className='text-muted-foreground text-xs'>{hint}</p>
      </CardContent>
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

/** Horizontal magnitude bars (one hue); value in text ink, tooltip on hover. */
function BarList({ rows, unit, empty = 'Belum ada data.' }: { rows: CountRow[]; unit: string; empty?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  if (rows.length === 0) return <p className='text-muted-foreground text-sm'>{empty}</p>;
  return (
    <ul className='space-y-2.5'>
      {rows.map((r) => (
        <li key={r.key} title={`${r.label}: ${r.count} ${unit}`} className='group'>
          <div className='mb-1 flex items-baseline justify-between gap-3 text-sm'>
            <span className='truncate'>{r.label}</span>
            <span className='text-muted-foreground shrink-0 tabular-nums'>{r.count}</span>
          </div>
          <div className='bg-muted h-2 overflow-hidden rounded-full'>
            <div
              className='bg-primary group-hover:bg-primary/80 h-full rounded-full transition-colors'
              style={{ width: `${(r.count / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Registrations per month: vertical bars, label under each bar. */
function MonthBars({ rows }: { rows: { month: string; count: number }[] }) {
  const last = rows.slice(-12);
  const max = Math.max(1, ...last.map((r) => r.count));
  if (last.length === 0) return <p className='text-muted-foreground text-sm'>Belum ada data.</p>;
  return (
    <div className='flex h-40 items-end gap-1.5'>
      {last.map((r) => {
        const d = new Date(`${r.month}-01T00:00:00`);
        const name = d.toLocaleDateString('id-ID', { month: 'short', year: '2-digit' });
        return (
          <div key={r.month} className='group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1' title={`${name}: ${r.count} kandidat`}>
            <span className='text-muted-foreground text-[10px] tabular-nums'>{r.count}</span>
            <div
              className='bg-primary group-hover:bg-primary/80 w-full max-w-10 rounded-t transition-colors'
              style={{ height: `${Math.max(4, (r.count / max) * 100)}%` }}
            />
            <span className='text-muted-foreground truncate text-[10px]'>{name}</span>
          </div>
        );
      })}
    </div>
  );
}

function Panel({ title, description, children, className }: { title: string; description?: string; children: React.ReactNode; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className='text-base'>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** Talent Pool (PRD §5.8, unique people) + Recruitment Pipeline (§5.9, applications). */
export function RecruitmentDashboardPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [filters, setFilters] = useState({ track: '', job: '', employment_type: '', from: '', to: '' });
  const [pool, setPool] = useState<TalentPoolDashboard | null>(null);
  const [pipe, setPipe] = useState<PipelineDashboard | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    listJobs()
      .then(setJobs)
      .catch(() => setJobs([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setPool(null);
    setPipe(null);
    setError(false);
    Promise.all([getTalentPoolDashboard(filters), getPipelineDashboard({ track: filters.track, job: filters.job })])
      .then(([p, q]) => {
        if (cancelled) return;
        setPool(p);
        setPipe(q);
      })
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [filters]);

  const set = (key: keyof typeof filters, value: string) => setFilters((f) => ({ ...f, [key]: value }));
  const filtered = Object.values(filters).some(Boolean);

  return (
    <div className='flex flex-1 flex-col gap-4 p-4 md:p-6'>
      <div>
        <h2 className='text-2xl font-bold tracking-tight'>Dashboard Rekrutmen</h2>
        <p className='text-muted-foreground text-sm'>Talent Pool menghitung orang unik; Pipeline menghitung lamaran.</p>
      </div>

      <div className='grid gap-3 md:grid-cols-6'>
        <div>
          <Label className='text-xs'>Track</Label>
          <select className={selectClass} value={filters.track} onChange={(e) => set('track', e.target.value)}>
            <option value=''>Semua</option>
            {Object.entries(TRACK_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div className='md:col-span-2'>
          <Label className='text-xs'>Posisi</Label>
          <select className={selectClass} value={filters.job} onChange={(e) => set('job', e.target.value)}>
            <option value=''>Semua</option>
            <option value='open'>Open Application</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.title}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label className='text-xs'>Employment Type</Label>
          <select className={selectClass} value={filters.employment_type} onChange={(e) => set('employment_type', e.target.value)}>
            <option value=''>Semua</option>
            {Object.entries(EMPLOYMENT_TYPE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label className='text-xs'>Daftar dari</Label>
          <Input type='date' value={filters.from} onChange={(e) => set('from', e.target.value)} />
        </div>
        <div>
          <Label className='text-xs'>Daftar sampai</Label>
          <Input type='date' value={filters.to} onChange={(e) => set('to', e.target.value)} />
        </div>
        {filtered && (
          <div className='md:col-span-6'>
            <Button size='sm' variant='ghost' onClick={() => setFilters({ track: '', job: '', employment_type: '', from: '', to: '' })}>
              Reset filter
            </Button>
          </div>
        )}
      </div>

      {error ? (
        <p className='text-muted-foreground py-10 text-center text-sm'>Gagal memuat dashboard.</p>
      ) : !pool || !pipe ? (
        <div className='grid gap-4 md:grid-cols-4'>
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className='h-28 w-full' />
          ))}
        </div>
      ) : (
        <>
          <section className='space-y-4'>
            <h3 className='text-lg font-semibold'>Talent Pool</h3>
            <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
              <Stat title='Kandidat terdaftar' value={pool.total_profiles} hint='orang unik' href='/dashboard/recruitment/talent-pool' />
              <Stat title='Total lamaran' value={pool.total_applications} hint='dari kandidat di atas' />
              <Stat title='Qualified' value={pool.qualified_profiles} hint='lolos screening minimal sekali' />
              <Stat title='Siap untuk peluang berikutnya' value={pool.available_profiles} hint='tidak sedang diproses & belum hired' />
            </div>
            <div className='grid gap-4 lg:grid-cols-3'>
              <Panel title='Pendaftar per bulan' description='Kandidat unik berdasarkan tanggal daftar' className='lg:col-span-2'>
                <MonthBars rows={pool.by_month} />
              </Panel>
              <Panel title='Preferensi employment type' description='Satu kandidat bisa memilih lebih dari satu'>
                <BarList rows={pool.by_employment_type} unit='kandidat' />
              </Panel>
              <Panel title='Area minat (posisi dilamar)'>
                <BarList rows={pool.by_interest.slice(0, 8)} unit='kandidat' />
              </Panel>
              <Panel title='Sumber (jawaban kandidat)'>
                <BarList rows={pool.by_source} unit='kandidat' />
              </Panel>
              <Panel title='Availability'>
                <BarList rows={pool.by_availability} unit='kandidat' />
              </Panel>
            </div>
          </section>

          <section className='space-y-4'>
            <h3 className='text-lg font-semibold'>Recruitment Pipeline</h3>
            <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
              <Stat title='HR Interview' value={pipe.hr_interview} hint='lamaran di tahap ini' />
              <Stat title='User Interview' value={pipe.user_interview} hint='lamaran di tahap ini' />
              <Stat title='Perlu tindak lanjut' value={pipe.awaiting_follow_up} hint='New/Screened/Contacted > 7 hari' />
              <Stat title='Hired / Assigned' value={pipe.hired} hint={`dari ${pipe.total_applications} lamaran`} />
            </div>
            <div className='grid gap-4 lg:grid-cols-3'>
              <Panel title='Lamaran per tahap'>
                <BarList rows={pipe.by_stage} unit='lamaran' />
              </Panel>
              <Panel title='Sumber lamaran' description='Channel tercatat sistem (link ?ref=)'>
                <BarList rows={pipe.by_source} unit='lamaran' />
              </Panel>
              <Panel title='Perlu tindak lanjut' description='Tidak ada perubahan > 7 hari'>
                {pipe.follow_up.length === 0 ? (
                  <p className='text-muted-foreground text-sm'>Semua lamaran aktif sudah ditindaklanjuti.</p>
                ) : (
                  <ul className='divide-y text-sm'>
                    {pipe.follow_up.map((f) => (
                      <li key={f.id}>
                        <Link href={`/dashboard/recruitment/candidates/${f.id}`} className='flex items-center justify-between gap-2 py-2 hover:underline'>
                          <span className='min-w-0'>
                            <span className='block truncate font-medium'>{f.full_name}</span>
                            <span className='text-muted-foreground block truncate text-xs'>{f.position}</span>
                          </span>
                          <Badge variant='secondary' className='shrink-0'>
                            {statusLabel(f.status)}
                          </Badge>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>
            <Panel title='Status per posisi & track'>
              {pipe.by_position.length === 0 ? (
                <p className='text-muted-foreground text-sm'>Belum ada lamaran.</p>
              ) : (
                <div className='overflow-x-auto'>
                  <table className='w-full text-sm'>
                    <thead className='text-muted-foreground border-b text-xs'>
                      <tr>
                        <th className='py-2 pr-4 text-left font-medium'>Posisi</th>
                        <th className='py-2 pr-4 text-left font-medium'>Track</th>
                        {STATUS_COLUMNS.map((s) => (
                          <th key={s} className='px-2 py-2 text-right font-medium whitespace-nowrap'>
                            {statusLabel(s)}
                          </th>
                        ))}
                        <th className='py-2 pl-2 text-right font-medium'>Total</th>
                      </tr>
                    </thead>
                    <tbody className='divide-y'>
                      {pipe.by_position.map((r) => (
                        <tr key={`${r.position}-${r.track}`}>
                          <td className='py-2 pr-4'>{r.position}</td>
                          <td className='text-muted-foreground py-2 pr-4 text-xs'>{label(TRACK_LABELS, r.track)}</td>
                          {STATUS_COLUMNS.map((s) => (
                            <td key={s} className='text-muted-foreground px-2 py-2 text-right tabular-nums'>
                              {r.statuses[s] ?? '–'}
                            </td>
                          ))}
                          <td className='py-2 pl-2 text-right font-medium tabular-nums'>{r.total}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </section>
        </>
      )}
    </div>
  );
}
