import { Metadata } from 'next';
import { Suspense } from 'react';
import { RecruitmentJobsPage } from '@/features/recruitment/recruitment-jobs-page';

export const metadata: Metadata = {
  title: 'Job Management',
  description: 'Kelola lowongan kerja dan portal publik.'
};

export default function Page() {
  return (
    <Suspense>
      <RecruitmentJobsPage />
    </Suspense>
  );
}
