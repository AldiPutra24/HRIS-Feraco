import { Metadata } from 'next';
import { Suspense } from 'react';
import { RecruitmentCandidatesPage } from '@/features/recruitment/recruitment-candidates-page';

export const metadata: Metadata = {
  title: 'Job Applications'
};

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <RecruitmentCandidatesPage fixedJobId={id} />
    </Suspense>
  );
}
