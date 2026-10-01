import { Metadata } from 'next';

import { ApplyFormsPage } from '@/features/recruitment/apply-forms-page';

export const metadata: Metadata = {
  title: 'Form Job Portal Freelance',
  description: 'Kelola form publik lamaran freelance dan lihat applicants.',
};

export default function Page() {
  return <ApplyFormsPage />;
}
