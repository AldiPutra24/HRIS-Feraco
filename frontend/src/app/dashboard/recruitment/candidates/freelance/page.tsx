import { Metadata } from 'next';
import { Suspense } from 'react';
import { RecruitmentCandidatesPage } from '@/features/recruitment/recruitment-candidates-page';

export const metadata: Metadata = {
  title: 'Candidate Freelance',
  description: 'Kandidat recruitment freelance.'
};

export default function Page() {
  return (
    <Suspense>
      <RecruitmentCandidatesPage recruitmentType='FREELANCE' />
    </Suspense>
  );
}
