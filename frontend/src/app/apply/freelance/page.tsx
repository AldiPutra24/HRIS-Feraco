import type { Metadata } from 'next';

import { FreelanceApplyPage } from '@/features/recruitment/freelance-apply-page';

export const metadata: Metadata = {
  title: 'Lamar Freelance — FERACO',
  description:
    'Satu link untuk semua posisi freelance di FERACO. Pilih posisi, isi biodata, unggah CV.',
};

export default function Page() {
  return <FreelanceApplyPage />;
}
