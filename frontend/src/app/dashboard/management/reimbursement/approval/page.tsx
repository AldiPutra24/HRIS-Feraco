import { Suspense } from 'react';
import { GmReimbursementApproval } from '@/features/reimbursement/gm-reimbursement-approval';

export const metadata = { title: 'Persetujuan Reimbursement HR Lead' };

export default function Page() {
  return (
    <Suspense>
      <GmReimbursementApproval />
    </Suspense>
  );
}
