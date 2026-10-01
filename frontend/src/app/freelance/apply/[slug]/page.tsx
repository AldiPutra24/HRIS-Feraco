import type { Metadata } from 'next';

import { FreelanceApplyPage } from '@/features/recruitment/freelance-apply-page';

export const metadata: Metadata = {
  title: 'Lamar Freelance — FERACO',
  description: 'Formulir pendaftaran freelance FERACO. Pilih posisi, isi biodata, unggah CV.',
};

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <FreelanceApplyPage slug={slug} />;
}
