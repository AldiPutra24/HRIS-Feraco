import { Metadata } from 'next';
import { Suspense } from 'react';
import { TalentPoolPage } from '@/features/recruitment/talent-pool-page';

export const metadata: Metadata = {
  title: 'Talent Pool',
  description: 'Database kandidat in-house dan freelance.'
};

export default function Page() {
  return (
    <Suspense>
      <TalentPoolPage />
    </Suspense>
  );
}
