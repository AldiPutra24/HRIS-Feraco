import { Metadata } from 'next';
import { Suspense } from 'react';
import { RecruitmentCandidateDetailPage } from '@/features/recruitment/recruitment-candidate-detail-page';

export const metadata: Metadata = {
  title: 'Candidate Detail'
};

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <RecruitmentCandidateDetailPage id={id} />
    </Suspense>
  );
}
