import { Suspense } from 'react';
import { FinanceRecapPage } from '@/features/reimbursement/finance-recap-page';

export const metadata = { title: 'Rekap Reimbursement' };

// Finance (position flag `can_recap_reimbursement`); backend enforces access.
export default function Page() {
  return (
    <Suspense>
      <FinanceRecapPage />
    </Suspense>
  );
}
