import { Metadata } from 'next';
import { RecruitmentDashboardPage } from '@/features/recruitment/recruitment-dashboard-page';

export const metadata: Metadata = {
  title: 'Dashboard Rekrutmen',
  description: 'Ringkasan Talent Pool dan pipeline rekrutmen.'
};

export default function Page() {
  return <RecruitmentDashboardPage />;
}
