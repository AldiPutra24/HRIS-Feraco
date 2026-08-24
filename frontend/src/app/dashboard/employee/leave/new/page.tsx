import { LeaveForm } from '@/features/leaves/leave-form';

export const metadata = { title: 'Ajukan Cuti' };

export default function Page() {
  return <LeaveForm redirectTo='/dashboard/employee/leave' />;
}
