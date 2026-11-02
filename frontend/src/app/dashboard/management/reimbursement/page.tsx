import { EmployeeReimbursement } from '@/features/reimbursement/employee-reimbursement';

export const metadata = { title: 'Pengajuan Saya' };

export default function Page() {
  return <EmployeeReimbursement newHref='/dashboard/management/reimbursement/new' />;
}
