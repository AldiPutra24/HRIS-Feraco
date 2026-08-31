import { Metadata } from 'next';
import { Suspense } from 'react';
import { RecruitmentCandidatesPage } from '@/features/recruitment/recruitment-candidates-page';

export const metadata: Metadata = {
  title: 'Candidate Inbox',
  description: 'Kelola lamaran masuk.'
};

export default function Page() {
  return (
    <Suspense>
      <RecruitmentCandidatesPage />
    </Suspense>
  );
}
