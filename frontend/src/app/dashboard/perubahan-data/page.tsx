import { Suspense } from 'react';
import { ChangeRequestReview } from '@/features/employees/change-request-review';

export const metadata = { title: 'Perubahan Data Karyawan' };

export default function Page() {
  return (
    <Suspense>
      <ChangeRequestReview />
    </Suspense>
  );
}
