import { Metadata } from 'next';
import { PublicJobPage } from '@/features/recruitment/public-job-page';

export const metadata: Metadata = {
  title: 'Lowongan Kerja'
};

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <PublicJobPage slug={slug} />;
}
