import { Metadata } from 'next';
import { Suspense } from 'react';
import { RecruitmentCandidatesPage } from '@/features/recruitment/recruitment-candidates-page';

export const metadata: Metadata = {
  title: 'Candidate Freelance / Talent Pool',
  description: 'Kandidat recruitment freelance.'
};

export default function Page() {
  return (
    <Suspense>
      <RecruitmentCandidatesPage recruitmentType='FREELANCE' />
    </Suspense>
  );
}
