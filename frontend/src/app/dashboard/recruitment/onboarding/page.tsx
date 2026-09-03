import { Metadata } from 'next';
import { Suspense } from 'react';
import { OnboardingPage } from '@/features/onboarding/onboarding-page';

export const metadata: Metadata = {
  title: 'Onboarding',
  description: 'Kelola proses onboarding kandidat.'
};

export default function Page() {
  return (
    <Suspense>
      <OnboardingPage />
    </Suspense>
  );
}
