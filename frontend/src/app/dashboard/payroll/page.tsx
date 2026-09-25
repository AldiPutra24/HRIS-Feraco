'use client';

import { useAuth } from '@/lib/auth/auth-provider';
import { PayrollPage } from '@/features/payroll/payroll-page';
import { EmployeePayslip } from '@/features/payroll/employee-payslip';
import { Skeleton } from '@/components/ui/skeleton';

// ADMIN/HR_LEAD get the full payroll admin console (read + write).
// GENERAL_MANAGER gets a READ-ONLY view of the same console: payment types,
// struktur gaji, payroll processing, konfigurasi pajak — semua tombol
// mutation disembunyikan (backend juga menolak setiap mutation dengan 403).
// HR_STAFF/MANAGEMENT/EMPLOYEE get the self-service view: their own payslips.
const PAYROLL_ADMIN_ROLES = ['admin', 'hr_lead'];
const PAYROLL_READONLY_ROLES = ['general_manager'];

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

  const role = user?.role ?? '';
  if (PAYROLL_ADMIN_ROLES.includes(role)) {
    return <PayrollPage />;
  }
  if (PAYROLL_READONLY_ROLES.includes(role)) {
    return <PayrollPage readOnly />;
  }
  return <EmployeePayslip />;
}
