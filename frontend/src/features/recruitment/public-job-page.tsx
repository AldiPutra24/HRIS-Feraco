'use client';

import { useEffect, useState } from 'react';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getPublicJob, type PublicJob } from '@/lib/recruitment';
import { ApplyForm } from '@/features/recruitment/apply-form';

function employmentLabel(v: string): string {
  return v.replace('_', ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export function PublicJobPage({ slug }: { slug: string }) {
  const [job, setJob] = useState<PublicJob | null>(null);
  const [notFoundState, setNotFoundState] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getPublicJob(slug)
      .then(setJob)
      .catch(() => setNotFoundState(true))
      .finally(() => setLoading(false));
  }, [slug]);

  if (notFoundState) notFound();

  if (loading) {
    return (
      <div className='flex min-h-screen items-center justify-center'>
        <p className='text-muted-foreground'>Memuat...</p>
      </div>
    );
  }

  if (!job) return null;

  return (
    <main className='min-h-screen bg-[linear-gradient(135deg,#F7FBFD_0%,#EDF8FC_50%,#F5FAFC_100%)] py-10'>
      <div className='mx-auto w-full max-w-3xl px-4'>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src='/frc-recruitment.webp'
          alt='FeraCo Recruitment'
          className='mb-6 h-40 w-full rounded-2xl object-cover md:h-56'
        />
        <Card>
          <CardHeader>
            <div className='flex flex-wrap items-center gap-2'>
              <span className='text-muted-foreground text-sm'>{job.department_name || 'Umum'}</span>
              {job.position_name && (
                <span className='text-muted-foreground text-sm'>· {job.position_name}</span>
              )}
              {job.position_text && (
                <span className='text-muted-foreground text-sm'>· {job.position_text}</span>
              )}
            </div>
            <CardTitle className='text-2xl font-bold tracking-tight'>{job.title}</CardTitle>
            <CardDescription>
              {job.recruitment_type === 'FREELANCE' ? 'Freelance' : employmentLabel(job.employment_type)}
              {job.location ? ` · ${job.location}` : ''}
              {' · '}
              {job.open_date} {job.close_date ? `– ${job.close_date}` : ''}
            </CardDescription>
          </CardHeader>
          <CardContent className='space-y-5'>
            {job.description && (
              <div>
                <h3 className='mb-1 text-sm font-semibold'>Deskripsi</h3>
                <p className='text-muted-foreground whitespace-pre-line text-sm'>{job.description}</p>
              </div>
            )}
            {job.requirements && (
              <div>
                <h3 className='mb-1 text-sm font-semibold'>Persyaratan</h3>
                <p className='text-muted-foreground whitespace-pre-line text-sm'>{job.requirements}</p>
              </div>
            )}

            <div className='border-border space-y-4 border-t pt-5'>
              <h3 className='text-sm font-semibold'>Apply for this position</h3>
              <ApplyForm defaultJobId={job.id} />
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
