import { Metadata } from 'next';
import { Suspense } from 'react';
import { RecruitmentCandidatesPage } from '@/features/recruitment/recruitment-candidates-page';
import { RecruitmentJobPipeline } from '@/features/recruitment/recruitment-job-pipeline';

export const metadata: Metadata = {
  title: 'Job Applications'
};

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className='flex flex-1 flex-col gap-4 p-4 md:p-6'>
      <div>
        <h2 className='text-2xl font-bold tracking-tight'>Pipeline Lamaran</h2>
        <p className='text-muted-foreground text-sm'>Tampilan pipeline kandidat per lowongan.</p>
      </div>
      <Suspense>
        <RecruitmentJobPipeline jobId={id} />
      </Suspense>
      <Suspense>
        <RecruitmentCandidatesPage fixedJobId={id} />
      </Suspense>
    </div>
  );
}
