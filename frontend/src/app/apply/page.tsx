import { Metadata } from 'next';
import { PublicApplyPage } from '@/features/recruitment/public-apply-page';

export const metadata: Metadata = {
  title: { absolute: 'Recruitment & Talent Pool | Feraco' }
};

export default function Page() {
  return <PublicApplyPage />;
}
