import { Metadata } from 'next';
import { Suspense } from 'react';
import { OnboardingDetailPage } from '@/features/onboarding/onboarding-detail-page';

export const metadata: Metadata = {
  title: 'Onboarding Detail'
};

export default function Page() {
  return (
    <Suspense>
      <OnboardingDetailPage />
    </Suspense>
  );
}
