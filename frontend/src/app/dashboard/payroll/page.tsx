'use client';

import { useAuth } from '@/lib/auth/auth-provider';
import { PayrollPage } from '@/features/payroll/payroll-page';
import { EmployeePayslip } from '@/features/payroll/employee-payslip';
import { Skeleton } from '@/components/ui/skeleton';

// ADMIN/HR see the full payroll admin console (components, structures,
// processing, tax). MANAGEMENT/GENERAL_MANAGER (and any other role without
// payroll-admin access) get the self-service view: their own payslips only —
// matching the backend scope enforced in apps/payroll.
const PAYROLL_ADMIN_ROLES = ['admin', 'hr_staff', 'hr_lead'];

export default function PayrollDashboardPage() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className='flex flex-1 flex-col gap-4 p-4 md:p-6'>
        <Skeleton className='h-8 w-48' />
        <Skeleton className='h-64 w-full' />
      </div>
    );
  }

  if (user && PAYROLL_ADMIN_ROLES.includes(user.role ?? '')) {
    return <PayrollPage />;
  }
  return <EmployeePayslip />;
}
